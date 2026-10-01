import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from services.whatsflow import WhatsflowClient
from services import whatsapp_phone_mirror as mirror
from routes import whatsapp as mod


def run(coro):
    return asyncio.run(coro)


def record(jid='966500000001@s.whatsapp.net', from_me=False, private=False):
    return {'key': {'id': 'message-1', 'remoteJid': jid, 'fromMe': from_me},
            'messageTimestamp': int(datetime.now(timezone.utc).timestamp()), 'status': 'READ',
            'message': {'viewOnceMessage': {'message': {'imageMessage': {}}}} if private else {'conversation': 'history'}}


def test_history_directions_and_scope_and_private_media():
    identity = mirror.chat_identity('a', {'remoteJid': '966500000001@s.whatsapp.net'})
    build = mod._phone_message_builder('a')
    incoming = build(identity, record())
    assert incoming['direction'] == 'inbound'
    assert incoming['unread'] is False
    assert incoming['source'] == 'phone_history'
    assert 'human_reply' not in incoming
    assert build(identity, record(from_me=True))['direction'] == 'outbound'
    assert build(identity, record(jid='966500000002@s.whatsapp.net')) is None
    assert build(identity, record(private=True)) is None


def test_group_and_lid_identity_cannot_be_sent_as_phone():
    for jid in ['123-456@g.us', '123456@lid']:
        identity = mirror.chat_identity('a', {'remoteJid': jid})
        assert identity['phone'] == ''
        assert identity['read_only_chat'] is True
        assert identity['id'] == f'a:{jid}'
    assert mirror.chat_identity('a', {'remoteJid': 'status@broadcast'}) is None
    aliased = mirror.chat_identity('a', {
        'remoteJid': '123456@lid',
        'lastMessage': {'key': {'remoteJidAlt': '966500000001@s.whatsapp.net'}},
    })
    assert aliased['id'] == 'a:966500000001'
    assert aliased['remote_jid'] == '123456@lid'
    assert aliased['read_only_chat'] is False


@pytest.mark.parametrize('value,expected', [(0, 0), (42, 42), (-1, 1), (-2, None), (True, None), ('5', None), (None, None)])
def test_unread_is_provider_evidence(value, expected):
    assert mirror.unread_value({'unreadCount': value}) == expected


def test_lid_zero_is_unknown_not_proof_of_phone_read():
    assert mirror.unread_value({'remoteJid': '123@lid', 'unreadCount': 0}) is None
    assert mirror.unread_value({'remoteJid': '123@lid', 'unreadCount': 2}) == 2


def test_snapshot_preserves_existing_messages_and_scopes_bulk_writes():
    messages = MagicMock()
    messages.create_index = AsyncMock()
    messages.bulk_write = AsyncMock()
    messages.find.return_value.to_list = AsyncMock(return_value=[])
    conversations = AsyncMock()
    state = AsyncMock()
    db = {'whatsapp_cloud_messages': messages, 'whatsapp_cloud_conversations': conversations,
          'whatsapp_phone_sync': state}
    rows = [{'remoteJid': '966500000001@s.whatsapp.net', 'unreadCount': 12, 'lastMessage': record()},
            {'remoteJid': '123-456@g.us', 'unreadCount': 1, 'lastMessage': record('123-456@g.us')},
            {'remoteJid': '123@lid', 'lastMessage': record('123@lid')}]
    result = run(mirror.store_snapshot(db, 'a', rows, mod._phone_message_builder('a')))
    assert result == {'success': True, 'chats': 3, 'unread_chats': 2, 'excluded': 0, 'unknown_read_chats': 1}
    for operation in messages.bulk_write.call_args.args[0]:
        assert operation._filter['branch_id'] == 'a'
        assert set(operation._doc) == {'$setOnInsert'}
    for operation in conversations.bulk_write.call_args.args[0]:
        assert operation._filter['branch_id'] == 'a'
        if operation._doc['$set']['phone_unread_known']:
            assert operation._doc['$set']['unread_count'] in [12, 1]
        else:
            assert 'unread_count' not in operation._doc['$set']
            assert operation._doc['$setOnInsert']['unread_count'] == 0
        assert operation._doc['$set']['phone_unread_known'] == (operation._doc['$set']['phone_unread_count'] is not None)
        assert operation._doc['$set']['needs_reply'] == (not operation._doc['$set'].get('read_only_chat'))


def test_offline_snapshot_keeps_unread_and_branch_scope(monkeypatch):
    saved = {'branch_id': 'a', 'snapshot': 'saved', 'synced_at': '2020-01-01T00:00:00+00:00', 'unread_chats': 9}
    state = AsyncMock()
    state.find_one.return_value = saved
    monkeypatch.setattr(mod, '_db', {'whatsapp_phone_sync': state})
    client = AsyncMock()
    client.find_chats.return_value = (False, None, 'offline')
    monkeypatch.setattr(mod, '_phone_client', AsyncMock(return_value=client))
    result = run(mod._refresh_phone_snapshot('a'))
    assert result == {**saved, 'stale': True}
    state.update_one.assert_not_called()
    with pytest.raises(HTTPException):
        run(mod._refresh_phone_snapshot('a', force=True))


def test_bad_snapshot_does_not_clear_saved_unreads():
    state = AsyncMock()
    db = {'whatsapp_phone_sync': state}
    with pytest.raises(ValueError):
        run(mirror.store_snapshot(db, 'a', [{'remoteJid': '123@s.whatsapp.net'}], lambda *_: None))
    state.update_one.assert_not_called()


def test_snapshot_includes_old_read_state_without_importing_old_messages():
    db = {name: AsyncMock() for name in ['whatsapp_cloud_messages', 'whatsapp_cloud_conversations', 'whatsapp_phone_sync']}
    old = record()
    old['messageTimestamp'] = int((datetime.now(timezone.utc) - timedelta(days=31)).timestamp())
    result = run(mirror.store_snapshot(db, 'a', [{'remoteJid': old['key']['remoteJid'], 'unreadCount': 7, 'lastMessage': old}], mod._phone_message_builder('a')))
    assert result['chats'] == result['unread_chats'] == 1
    db['whatsapp_cloud_messages'].bulk_write.assert_not_called()
    saved = db['whatsapp_cloud_conversations'].bulk_write.call_args.args[0][0]._doc['$set']
    assert saved['unread_count'] == 7
    assert saved['phone_last_message_key']['id'] == 'message-1'
    db['whatsapp_cloud_conversations'].delete_many.assert_not_called()


def test_snapshot_resolves_lid_from_webhook_without_clearing_local_unread():
    messages = MagicMock()
    messages.create_index = AsyncMock()
    messages.bulk_write = AsyncMock()
    messages.find.return_value.to_list = AsyncMock(return_value=[
        {'provider_message_id': 'message-1', 'phone': '966500000001',
         'body': 'ما هي مواعيد الحصص؟', 'direction': 'inbound'},
    ])
    messages.aggregate.return_value.to_list = AsyncMock(return_value=[
        {'_id': 'a:966500000001', 'count': 2},
    ])
    conversations = AsyncMock()
    db = {'whatsapp_cloud_messages': messages, 'whatsapp_cloud_conversations': conversations,
          'whatsapp_phone_sync': AsyncMock()}
    lid_message = record(jid='123456@lid')
    lid_message['message'] = {}
    result = run(mirror.store_snapshot(db, 'a', [
        {'remoteJid': '123456@lid', 'unreadCount': None, 'lastMessage': lid_message},
        {'remoteJid': '966500000002@s.whatsapp.net', 'unreadCount': 0},
    ], mod._phone_message_builder('a'), recover_unread=True))
    assert result['unknown_read_chats'] == 1
    saved = conversations.bulk_write.call_args_list[0].args[0][0]
    assert saved._filter['id'] == 'a:966500000001'
    assert saved._doc['$set']['remote_jid'] == '123456@lid'
    assert saved._doc['$set']['phone_unread_known'] is False
    assert saved._doc['$set']['last_message'] == 'ما هي مواعيد الحصص؟'
    assert saved._doc['$setOnInsert']['contact_name'] == '966500000001'
    assert 'unread_count' not in saved._doc['$set']
    assert saved._doc['$setOnInsert']['unread_count'] == 0
    recovery = conversations.bulk_write.call_args_list[1].args[0][0]
    assert recovery._doc == {'$max': {'unread_count': 2}}
    assert recovery._filter['id'] == 'a:966500000001'


def test_older_phone_history_remains_available_by_page(monkeypatch):
    old = record()
    old['messageTimestamp'] = int((datetime.now(timezone.utc) - timedelta(days=31)).timestamp())
    client = AsyncMock()
    client.history_page.return_value = (True, {'records': [old], 'has_more': True, 'total': 51}, None)
    monkeypatch.setattr(mod, '_phone_client', AsyncMock(return_value=client))
    store = AsyncMock()
    monkeypatch.setattr(mirror, 'store_messages', store)
    messages = MagicMock()
    messages.find.return_value.sort.return_value.to_list = AsyncMock(return_value=[])
    monkeypatch.setattr(mod, '_db', {'whatsapp_cloud_messages': messages})
    conversation = {'id': 'a:966500000001', 'branch_id': 'a',
                    'remote_jid': '966500000001@s.whatsapp.net', 'phone': '966500000001'}

    _, result, _ = run(mod._import_phone_history(conversation, page=2))

    assert result['has_more'] is True
    assert store.await_args.args[1][0]['provider_message_id'] == 'message-1'


def test_phone_read_action_uses_exact_inbound_provider_keys_and_confirms_state(monkeypatch):
    before = {'id': 'a:966500000001', 'branch_id': 'a', 'provider': 'whatsflow',
              'phone_mirrored': True, 'phone_unread_known': True, 'phone_unread_count': 2,
              'remote_jid': '966500000001@s.whatsapp.net'}
    after = {**before, 'phone_unread_count': 0}
    conversations = AsyncMock()
    conversations.find_one.side_effect = [before, before, after]
    monkeypatch.setattr(mod, '_db', {'whatsapp_cloud_conversations': conversations})
    monkeypatch.setattr(mod, '_require_bulk_whatsapp_access', lambda _: None)
    monkeypatch.setattr(mod, '_assert_branch_access', lambda *_: None)
    refresh = AsyncMock(side_effect=[{'snapshot': 'first'}, {'snapshot': 'second'}])
    monkeypatch.setattr(mod, '_refresh_phone_snapshot', refresh)
    client = AsyncMock()
    client.find_messages.return_value = (True, [record(), record(jid='999@s.whatsapp.net')], None)
    client.mark_messages_read.return_value = (True, {'read': 'success'}, None)
    monkeypatch.setattr(mod, '_phone_client', AsyncMock(return_value=client))

    result = run(mod.mark_cloud_phone_chat_read(before['id'], {'is_admin': True}))

    assert result['confirmed'] is True
    client.mark_messages_read.assert_awaited_once_with([
        {'remoteJid': before['remote_jid'], 'id': 'message-1', 'fromMe': False}
    ])
    assert refresh.await_count == 2


def test_phone_read_uses_number_alias_for_lid_provider_key(monkeypatch):
    before = {'id': 'a:966500000001', 'branch_id': 'a', 'provider': 'whatsflow',
              'phone_mirrored': True, 'phone_unread_known': True, 'phone_unread_count': 1,
              'remote_jid': '123456@lid', 'phone': '966500000001'}
    conversations = AsyncMock()
    conversations.find_one.side_effect = [before, before, {**before, 'phone_unread_count': 0}]
    monkeypatch.setattr(mod, '_db', {'whatsapp_cloud_conversations': conversations})
    monkeypatch.setattr(mod, '_require_bulk_whatsapp_access', lambda _: None)
    monkeypatch.setattr(mod, '_assert_branch_access', lambda *_: None)
    monkeypatch.setattr(mod, '_refresh_phone_snapshot', AsyncMock(side_effect=[
        {'snapshot': 'first'}, {'snapshot': 'second'}]))
    client = AsyncMock()
    client.find_messages.return_value = (True, [record(jid='123456@lid')], None)
    client.mark_messages_read.return_value = (True, {'read': 'success'}, None)
    monkeypatch.setattr(mod, '_phone_client', AsyncMock(return_value=client))

    result = run(mod.mark_cloud_phone_chat_read(before['id'], {'is_admin': True}))

    assert result['confirmed'] is True
    client.mark_messages_read.assert_awaited_once_with([
        {'remoteJid': '966500000001@s.whatsapp.net', 'id': 'message-1', 'fromMe': False},
    ])


def test_unknown_lid_read_uses_local_unread_but_does_not_claim_confirmation(monkeypatch):
    before = {'id': 'a:966500000001', 'branch_id': 'a', 'provider': 'whatsflow',
              'phone_mirrored': True, 'phone_unread_known': False,
              'phone_unread_count': None, 'unread_count': 2,
              'remote_jid': '123456@lid', 'phone': '966500000001'}
    conversations = AsyncMock()
    conversations.find_one.side_effect = [before, before, before]
    monkeypatch.setattr(mod, '_db', {'whatsapp_cloud_conversations': conversations})
    monkeypatch.setattr(mod, '_require_bulk_whatsapp_access', lambda _: None)
    monkeypatch.setattr(mod, '_assert_branch_access', lambda *_: None)
    monkeypatch.setattr(mod, '_refresh_phone_snapshot', AsyncMock(side_effect=[
        {'snapshot': 'first'}, {'snapshot': 'second'}]))
    client = AsyncMock()
    client.find_messages.return_value = (True, [record(jid='123456@lid')], None)
    client.mark_messages_read.return_value = (True, {'read': 'success'}, None)
    monkeypatch.setattr(mod, '_phone_client', AsyncMock(return_value=client))

    result = run(mod.mark_cloud_phone_chat_read(before['id'], {'is_admin': True}))

    assert result['accepted'] is True
    assert result['confirmed'] is False
    client.mark_messages_read.assert_awaited_once()


def test_phone_unread_action_never_claims_provider_acceptance_as_confirmation(monkeypatch):
    before = {'id': 'a:966500000001', 'branch_id': 'a', 'provider': 'whatsflow',
              'phone_mirrored': True, 'phone_unread_known': True, 'phone_unread_count': 0,
              'remote_jid': '966500000001@s.whatsapp.net',
              'phone_last_message_key': record()['key']}
    conversations = AsyncMock()
    conversations.find_one.side_effect = [before, before, before]
    monkeypatch.setattr(mod, '_db', {'whatsapp_cloud_conversations': conversations})
    monkeypatch.setattr(mod, '_require_bulk_whatsapp_access', lambda _: None)
    monkeypatch.setattr(mod, '_assert_branch_access', lambda *_: None)
    monkeypatch.setattr(mod, '_refresh_phone_snapshot', AsyncMock(side_effect=[
        {'snapshot': 'first'}, {'snapshot': 'second'}]))
    client = AsyncMock()
    client.mark_chat_unread.return_value = (True, {'read': 'success'}, None)
    monkeypatch.setattr(mod, '_phone_client', AsyncMock(return_value=client))

    result = run(mod.mark_cloud_phone_chat_unread(before['id'], {'is_admin': True}))

    assert result['accepted'] is True
    assert result['confirmed'] is False
    client.mark_chat_unread.assert_awaited_once_with(before['remote_jid'], before['phone_last_message_key'])


def test_phone_unread_action_finds_key_when_chat_snapshot_omits_last_message(monkeypatch):
    before = {'id': 'a:966500000001', 'branch_id': 'a', 'provider': 'whatsflow',
              'phone_mirrored': True, 'phone_unread_known': True, 'phone_unread_count': 0,
              'remote_jid': '966500000001@s.whatsapp.net'}
    after = {**before, 'phone_unread_count': 1}
    conversations = AsyncMock()
    conversations.find_one.side_effect = [before, before, after]
    monkeypatch.setattr(mod, '_db', {'whatsapp_cloud_conversations': conversations})
    monkeypatch.setattr(mod, '_require_bulk_whatsapp_access', lambda _: None)
    monkeypatch.setattr(mod, '_assert_branch_access', lambda *_: None)
    monkeypatch.setattr(mod, '_refresh_phone_snapshot', AsyncMock(side_effect=[
        {'snapshot': 'first'}, {'snapshot': 'second'}]))
    client = AsyncMock()
    client.history_page.return_value = (True, {'records': [record()], 'has_more': False, 'total': 1}, None)
    client.mark_chat_unread.return_value = (True, {'read': 'success'}, None)
    monkeypatch.setattr(mod, '_phone_client', AsyncMock(return_value=client))

    result = run(mod.mark_cloud_phone_chat_unread(before['id'], {'is_admin': True}))

    assert result['confirmed'] is True
    client.mark_chat_unread.assert_awaited_once_with(before['remote_jid'], record()['key'])


def test_phone_read_action_denies_other_branch_before_contacting_provider(monkeypatch):
    conversations = AsyncMock()
    conversations.find_one.return_value = {'id': 'a:1', 'branch_id': 'a', 'phone_mirrored': True,
                                           'provider': 'whatsflow'}
    monkeypatch.setattr(mod, '_db', {'whatsapp_cloud_conversations': conversations})
    monkeypatch.setattr(mod, '_require_bulk_whatsapp_access', lambda _: None)
    def deny(*_):
        raise HTTPException(403, 'other branch')
    monkeypatch.setattr(mod, '_assert_branch_access', deny)
    refresh = AsyncMock()
    monkeypatch.setattr(mod, '_refresh_phone_snapshot', refresh)
    with pytest.raises(HTTPException) as error:
        run(mod.mark_cloud_phone_chat_read('a:1', {'branch_id': 'b'}))
    assert error.value.status_code == 403
    refresh.assert_not_called()


def test_client_history_pages_both_directions_and_rejects_other_chat(monkeypatch):
    client = WhatsflowClient('instance', 'key')
    request = AsyncMock(return_value=(True, {'messages': {'records': [record()], 'total': 101}}, None))
    monkeypatch.setattr(client, '_request', request)
    ok, page, error = run(client.history_page('966500000001@s.whatsapp.net', 2))
    assert ok and page['has_more'] is True
    assert request.call_args.kwargs['json'] == {
        'where': {'key': {'remoteJid': '966500000001@s.whatsapp.net'}}, 'page': 2, 'offset': 50}
    request.return_value = True, {'messages': {'records': [record('999@s.whatsapp.net')], 'total': 1}}, None
    assert run(client.history_page('966500000001@s.whatsapp.net')) == (False, None, 'history_message_mismatch')


def test_client_marks_chat_unread_with_provider_message_key(monkeypatch):
    client = WhatsflowClient('instance', 'key')
    request = AsyncMock(return_value=(True, {'read': 'success'}, None))
    monkeypatch.setattr(client, '_request', request)
    key = record()['key']
    assert run(client.mark_chat_unread(key['remoteJid'], key))[0] is True
    assert request.call_args.kwargs['json'] == {
        'chat': key['remoteJid'], 'lastMessage': {'key': key}}
    request.reset_mock()
    assert run(client.mark_chat_unread('999@s.whatsapp.net', key))[0] is False
    request.assert_not_called()


def test_phone_sync_denies_other_branch_before_provider_call(monkeypatch):
    monkeypatch.setattr(mod, '_require_bulk_whatsapp_access', lambda _: None)
    refresh = AsyncMock()
    monkeypatch.setattr(mod, '_refresh_phone_snapshot', refresh)
    with pytest.raises(HTTPException) as error:
        run(mod.enable_phone_mirror('other', {'role': 'manager', 'branch_id': 'mine'}))
    assert error.value.status_code == 403
    refresh.assert_not_called()


def test_opening_mirrored_thread_does_not_mark_phone_messages_read(monkeypatch):
    conversation = {
        'id': 'a:123@lid', 'branch_id': 'a', 'remote_jid': '123@lid',
        'phone_mirrored': True, 'read_only_chat': True, 'unread_count': 2,
    }
    db = {
        'whatsapp_cloud_conversations': AsyncMock(),
        'branches': AsyncMock(),
    }
    db['whatsapp_cloud_conversations'].find_one.return_value = conversation.copy()
    db['branches'].find_one.return_value = {'name': 'Branch A'}
    monkeypatch.setattr(mod, '_db', db)
    monkeypatch.setattr(mod, '_require_bulk_whatsapp_access', lambda _: None)
    client = AsyncMock()
    history = {'records': [record('123@lid')], 'has_more': False, 'total': 1}
    messages = [{'id': 'message-1', 'direction': 'inbound', 'unread': True}]
    monkeypatch.setattr(mod, '_import_phone_history', AsyncMock(return_value=(client, history, messages)))
    refresh = AsyncMock(return_value={'unread_chats': 1})
    monkeypatch.setattr(mod, '_refresh_phone_snapshot', refresh)
    async def passthrough(rows, *args, **kwargs):
        return rows
    monkeypatch.setattr(mod, '_enrich_member_phone_matches', passthrough)
    monkeypatch.setattr(mod.campaign_inbox, 'merge_messages', lambda cloud, campaign: cloud)

    result = run(mod.get_cloud_inbox_thread('a:123@lid', {'is_admin': True}))

    assert result['conversation']['unread_count'] == 2
    assert result['messages'][0]['unread'] is True
    client.mark_messages_read.assert_not_called()
    refresh.assert_awaited_once_with('a')
