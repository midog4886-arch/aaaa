"""Read-only history imports. Never replay old messages through automations."""
import re
import uuid
from datetime import datetime, timedelta, timezone


def recent_timestamp(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed >= datetime.now(timezone.utc) - timedelta(days=30)
    except (TypeError, ValueError):
        return False
from pymongo import UpdateOne


def chat_identity(branch_id, row, phone_jid=None):
    jid = row.get('remoteJid') if isinstance(row, dict) else None
    if not isinstance(jid, str) or not re.fullmatch(r'[0-9-]+@(?:s\.whatsapp\.net|c\.us|g\.us|lid)', jid):
        return None
    if jid.endswith('@lid'):
        key = (row.get('lastMessage') or {}).get('key') or {}
        candidate = phone_jid or key.get('remoteJidAlt') or row.get('remoteJidAlt')
        phone = candidate.split('@')[0] if isinstance(candidate, str) and re.fullmatch(r'\d+@(?:s\.whatsapp\.net|c\.us)', candidate) else ''
    else:
        phone = jid.split('@')[0] if jid.endswith(('@s.whatsapp.net', '@c.us')) else ''
    return {'id': f'{branch_id}:{phone or jid}', 'remote_jid': jid,
            'phone': phone, 'read_only_chat': not bool(phone)}


async def phone_aliases_from_messages(db, branch_id, rows):
    """Resolve LID chats from authenticated webhook messages when the snapshot omits remoteJidAlt."""
    ids = []
    for row in rows:
        if not isinstance(row, dict) or not str(row.get('remoteJid') or '').endswith('@lid'):
            continue
        key = (row.get('lastMessage') or {}).get('key') or {}
        if isinstance(key, dict) and isinstance(key.get('id'), str) and key['id']:
            ids.append(key['id'])
    aliases = {}
    for offset in range(0, len(ids), 500):
        cursor = db['whatsapp_cloud_messages'].find({
            'branch_id': branch_id, 'provider': 'whatsflow',
            'provider_message_id': {'$in': ids[offset:offset + 500]},
        }, {'_id': 0, 'provider_message_id': 1, 'phone': 1, 'body': 1,
            'direction': 1, 'created_at': 1, 'view_once': 1})
        for message in await cursor.to_list(length=500):
            phone = message.get('phone')
            if isinstance(phone, str) and re.fullmatch(r'\d+', phone):
                aliases[message['provider_message_id']] = message
    return aliases


def unread_value(row):
    value = row.get('unreadCount')
    # -1 is WhatsApp's explicit "mark unread" flag, not a negative count.
    if isinstance(value, bool) or not isinstance(value, int) or value < -1:
        return None
    # Evolution's LID chat may have no matching Chat row and still return a
    # synthetic zero. Do not erase unread webhook evidence with that zero.
    if value == 0 and str(row.get('remoteJid') or '').endswith('@lid'):
        return None
    return max(value, 1) if value == -1 else value


def message_key(identity, record):
    key = record.get('key') if isinstance(record, dict) else None
    if (not isinstance(key, dict) or key.get('remoteJid') != identity['remote_jid']
            or not isinstance(key.get('id'), str) or not key['id']
            or not isinstance(key.get('fromMe'), bool)):
        return None
    return {'remoteJid': key['remoteJid'], 'id': key['id'], 'fromMe': key['fromMe']}


def message_document(branch_id, identity, record, normalize, extract_body, timestamp, view_once, status, archive):
    if not isinstance(record, dict):
        return None
    key = record.get('key')
    if not isinstance(key, dict) or key.get('remoteJid') != identity['remote_jid']:
        return None
    if not isinstance(key.get('id'), str) or not key['id'] or not isinstance(key.get('fromMe'), bool):
        return None
    raw = record.get('message')
    created = timestamp(record)
    if not isinstance(raw, dict) or not created or view_once(raw):
        return None
    parsed = normalize(raw)
    media = {}
    kind = 'text'
    for field, candidate_kind in [('imageMessage', 'image'), ('documentMessage', 'document'),
                                   ('audioMessage', 'audio'), ('videoMessage', 'video'), ('stickerMessage', 'image')]:
        if isinstance(parsed.get(field), dict):
            media, kind = parsed[field], candidate_kind
            break
    return archive({
        'id': str(uuid.uuid4()), 'conversation_id': identity['id'], 'branch_id': branch_id,
        'provider': 'whatsflow', 'provider_message_id': key['id'], 'phone': identity['phone'],
        'direction': 'outbound' if key['fromMe'] else 'inbound',
        'type': kind, 'body': extract_body(raw, record), 'created_at': created,
        'received_at': datetime.now(timezone.utc).isoformat(),
        'status': status(record) if key['fromMe'] else 'received', 'unread': False,
        'media_id': key['id'] if media else None, 'media_url': media.get('url'),
        'mime_type': media.get('mimetype'), 'filename': media.get('fileName'),
        'source': 'phone_history', 'view_once': False,
    })


async def store_messages(db, documents):
    if not documents:
        return
    await db['whatsapp_cloud_messages'].create_index(
        [('branch_id', 1), ('provider', 1), ('provider_message_id', 1)], unique=True,
        partialFilterExpression={'provider': 'whatsflow', 'provider_message_id': {'$exists': True}},
    )
    operations = [UpdateOne(
        {'branch_id': d['branch_id'], 'provider': 'whatsflow', 'provider_message_id': d['provider_message_id']},
        {'$setOnInsert': d}, upsert=True,
    ) for d in documents]
    await db['whatsapp_cloud_messages'].bulk_write(operations, ordered=False)


async def store_snapshot(db, branch_id, rows, build_message, recover_unread=False):
    token = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    operations, documents = [], []
    excluded = 0
    unread_chats = 0
    unknown_read_chats = 0
    has_read_evidence = False
    seen = set()
    unknown_ids = []
    message_aliases = await phone_aliases_from_messages(db, branch_id, rows)
    for row in rows:
        key = ((row.get('lastMessage') or {}).get('key') or {}) if isinstance(row, dict) else {}
        matched_message = message_aliases.get(key.get('id')) if isinstance(key, dict) else None
        alias = f"{matched_message['phone']}@s.whatsapp.net" if matched_message else None
        identity = chat_identity(branch_id, row, alias)
        unread = unread_value(row) if identity else None
        if identity is None:
            excluded += 1
            continue
        has_read_evidence = has_read_evidence or unread is not None or (
            type(row.get('unreadCount')) is int and row['unreadCount'] == 0
            and str(row.get('remoteJid') or '').endswith('@lid')
        )
        if identity['id'] in seen:
            excluded += 1
            continue
        seen.add(identity['id'])
        record = row.get('lastMessage') or {}
        preview = build_message(identity, record)
        last_at = (preview or {}).get('created_at') or (matched_message or {}).get('created_at') or row.get('updatedAt')
        # Read state belongs to the whole phone inbox, including quiet chats.
        # Keep the 30-day limit only for imported message bodies so an old
        # conversation cannot trigger a new reply workflow.
        document = preview if recent_timestamp(last_at) else None
        if document:
            documents.append(document)
        unread_chats += int(unread is not None and unread > 0)
        unknown_read_chats += int(unread is None)
        if unread is None:
            unknown_ids.append(identity['id'])
        provider_name = row.get('pushName') or row.get('name')
        if not provider_name and isinstance(record, dict):
            record_key = record.get('key') or {}
            if isinstance(record_key, dict) and record_key.get('fromMe') is False:
                provider_name = record.get('pushName')
        provider_name = provider_name.strip() if isinstance(provider_name, str) else ''
        if '@lid' in provider_name or provider_name.startswith('lid@'):
            provider_name = ''
        body = (preview or {}).get('body') or (
            (matched_message or {}).get('body') if not (matched_message or {}).get('view_once') else ''
        )
        metadata = {
            **identity, 'branch_id': branch_id, 'provider': 'whatsflow',
            # The local counter remains numeric for live webhook $inc writes;
            # phone_unread_known distinguishes unavailable state from read.
            'phone_unread_count': unread,
            'phone_unread_known': unread is not None,
            'phone_last_message_key': message_key(identity, record),
            'phone_snapshot': token, 'phone_synced_at': now, 'phone_mirrored': True,
            'last_message': body or ('رسالة' if record else ''),
            'last_message_at': last_at or now,
            'last_direction': (preview or {}).get('direction') or (matched_message or {}).get('direction'),
        }
        if provider_name:
            metadata['contact_name'] = provider_name
        # A native last message includes outgoing phone replies. Historical
        # imports lack human_reply metadata and must not be backfilled as
        # thousands of unanswered messages merely for that reason.
        if document:
            metadata['needs_reply'] = document['direction'] == 'inbound' and not identity.get('read_only_chat')
        if unread is not None:
            metadata['unread_count'] = unread
        operations.append(UpdateOne({'id': identity['id'], 'branch_id': branch_id},
                                   {'$set': metadata, '$setOnInsert': {
                                       'created_at': now,
                                       **({} if provider_name else {'contact_name': identity['phone'] or identity['remote_jid']}),
                                       **({'unread_count': 0} if unread is None else {}),
                                   }}, upsert=True))
    # A malformed snapshot must not silently erase unread information.
    if rows and (not seen or not has_read_evidence):
        raise ValueError('Provider returned no valid chat identities/unread counts')
    recovered_counts = {}
    if recover_unread:
        for offset in range(0, len(unknown_ids), 500):
            chunk = unknown_ids[offset:offset + 500]
            cursor = db['whatsapp_cloud_messages'].aggregate([
                {'$match': {'branch_id': branch_id, 'provider': 'whatsflow',
                            'conversation_id': {'$in': chunk},
                            'direction': 'inbound', 'unread': True}},
                {'$group': {'_id': '$conversation_id', 'count': {'$sum': 1}}},
            ])
            for item in await cursor.to_list(length=500):
                if item.get('_id') in chunk and type(item.get('count')) is int and item['count'] > 0:
                    recovered_counts[item['_id']] = item['count']
    await store_messages(db, documents)
    if operations:
        await db['whatsapp_cloud_conversations'].bulk_write(operations, ordered=False)
    if recovered_counts:
        await db['whatsapp_cloud_conversations'].bulk_write([
            UpdateOne({'id': conversation_id, 'branch_id': branch_id, 'phone_snapshot': token},
                      {'$max': {'unread_count': count}})
            for conversation_id, count in recovered_counts.items()
        ], ordered=False)
    state = {
        'enabled': True, 'snapshot': token, 'synced_at': now, 'chats': len(operations),
        'unread_chats': unread_chats, 'excluded': excluded,
        'unknown_read_chats': unknown_read_chats,
    }
    if recover_unread:
        state['unread_recovered_at'] = now
    await db['whatsapp_phone_sync'].update_one({'branch_id': branch_id}, {'$set': state}, upsert=True)
    return {'success': True, 'chats': len(operations), 'unread_chats': unread_chats, 'excluded': excluded, 'unknown_read_chats': unknown_read_chats}
