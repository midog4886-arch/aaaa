import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

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


@pytest.mark.parametrize('value,expected', [(0, 0), (42, 42), (-1, 1), (-2, None), (True, None), ('5', None), (None, None)])
def test_unread_is_provider_evidence(value, expected):
    assert mirror.unread_value({'unreadCount': value}) == expected


def test_snapshot_preserves_existing_messages_and_scopes_bulk_writes():
    messages = AsyncMock()
    conversations = AsyncMock()
    state = AsyncMock()
    db = {'whatsapp_cloud_messages': messages, 'whatsapp_cloud_conversations': conversations,
          'whatsapp_phone_sync': state}
    rows = [{'remoteJid': '966500000001@s.whatsapp.net', 'unreadCount': 12, 'lastMessage': record()},
            {'remoteJid': '123-456@g.us', 'unreadCount': 1, 'lastMessage': record('123-456@g.us')},
            {'remoteJid': '123@lid'}]
    result = run(mirror.store_snapshot(db, 'a', rows, mod._phone_message_builder('a')))
    assert result == {'success': True, 'chats': 2, 'unread_chats': 2, 'excluded': 1}
    for operation in messages.bulk_write.call_args.args[0]:
        assert operation._filter['branch_id'] == 'a'
        assert set(operation._doc) == {'$setOnInsert'}
    for operation in conversations.bulk_write.call_args.args[0]:
        assert operation._filter['branch_id'] == 'a'
        assert operation._doc['$set']['unread_count'] in [12, 1]
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


def test_snapshot_excludes_old_chats_without_deleting_history():
    db = {name: AsyncMock() for name in ['whatsapp_cloud_messages', 'whatsapp_cloud_conversations', 'whatsapp_phone_sync']}
    old = record()
    old['messageTimestamp'] = int((datetime.now(timezone.utc) - timedelta(days=31)).timestamp())
    result = run(mirror.store_snapshot(db, 'a', [{'remoteJid': old['key']['remoteJid'], 'unreadCount': 7, 'lastMessage': old}], mod._phone_message_builder('a')))
    assert result['chats'] == result['unread_chats'] == 0
    db['whatsapp_cloud_messages'].bulk_write.assert_not_called()
    db['whatsapp_cloud_conversations'].delete_many.assert_not_called()


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


def test_phone_sync_denies_other_branch_before_provider_call(monkeypatch):
    monkeypatch.setattr(mod, '_require_bulk_whatsapp_access', lambda _: None)
    refresh = AsyncMock()
    monkeypatch.setattr(mod, '_refresh_phone_snapshot', refresh)
    with pytest.raises(HTTPException) as error:
        run(mod.enable_phone_mirror('other', {'role': 'manager', 'branch_id': 'mine'}))
    assert error.value.status_code == 403
    refresh.assert_not_called()
