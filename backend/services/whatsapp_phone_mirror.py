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


def chat_identity(branch_id, row):
    jid = row.get('remoteJid') if isinstance(row, dict) else None
    if not isinstance(jid, str) or not re.fullmatch(r'[0-9-]+@(?:s\.whatsapp\.net|c\.us|g\.us|lid)', jid):
        return None
    phone = jid.split('@')[0] if jid.endswith(('@s.whatsapp.net', '@c.us')) else ''
    return {'id': f'{branch_id}:{phone or jid}', 'remote_jid': jid,
            'phone': phone, 'read_only_chat': not bool(phone)}


def unread_value(row):
    value = row.get('unreadCount')
    # -1 is WhatsApp's explicit "mark unread" flag, not a negative count.
    if isinstance(value, bool) or not isinstance(value, int) or value < -1:
        return None
    return max(value, 1) if value == -1 else value


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


async def store_snapshot(db, branch_id, rows, build_message):
    token = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    operations, documents = [], []
    excluded = 0
    unread_chats = 0
    unknown_read_chats = 0
    has_read_evidence = False
    seen = set()
    for row in rows:
        identity = chat_identity(branch_id, row)
        unread = unread_value(row) if identity else None
        if identity is None:
            excluded += 1
            continue
        has_read_evidence = has_read_evidence or unread is not None
        if identity['id'] in seen:
            excluded += 1
            continue
        seen.add(identity['id'])
        record = row.get('lastMessage') or {}
        document = build_message(identity, record)
        last_at = (document or {}).get('created_at') or row.get('updatedAt')
        if not recent_timestamp(last_at):
            continue
        if document:
            documents.append(document)
        unread_chats += int(unread is not None and unread > 0)
        unknown_read_chats += int(unread is None)
        metadata = {
            **identity, 'branch_id': branch_id, 'provider': 'whatsflow',
            'contact_name': row.get('pushName') or row.get('name') or identity['phone'] or identity['remote_jid'],
            # The local counter remains numeric for live webhook $inc writes;
            # phone_unread_known distinguishes unavailable state from read.
            'unread_count': unread if unread is not None else 0, 'phone_unread_count': unread,
            'phone_unread_known': unread is not None,
            'phone_snapshot': token, 'phone_synced_at': now, 'phone_mirrored': True,
            'last_message': (document or {}).get('body') or ('[message]' if record else ''),
            'last_message_at': (document or {}).get('created_at') or row.get('updatedAt') or now,
            'last_direction': (document or {}).get('direction'),
        }
        # A native last message includes outgoing phone replies. Historical
        # imports lack human_reply metadata and must not be backfilled as
        # thousands of unanswered messages merely for that reason.
        if document:
            metadata['needs_reply'] = document['direction'] == 'inbound' and not identity.get('read_only_chat')
        operations.append(UpdateOne({'id': identity['id'], 'branch_id': branch_id},
                                   {'$set': metadata, '$setOnInsert': {'created_at': now}}, upsert=True))
    # A malformed snapshot must not silently erase unread information.
    if rows and (not seen or not has_read_evidence):
        raise ValueError('Provider returned no valid chat identities/unread counts')
    await store_messages(db, documents)
    if operations:
        await db['whatsapp_cloud_conversations'].bulk_write(operations, ordered=False)
    await db['whatsapp_phone_sync'].update_one({'branch_id': branch_id}, {'$set': {
        'enabled': True, 'snapshot': token, 'synced_at': now, 'chats': len(operations),
        'unread_chats': unread_chats, 'excluded': excluded,
        'unknown_read_chats': unknown_read_chats,
    }}, upsert=True)
    return {'success': True, 'chats': len(operations), 'unread_chats': unread_chats, 'excluded': excluded, 'unknown_read_chats': unknown_read_chats}
