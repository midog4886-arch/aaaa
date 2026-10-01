import asyncio
from unittest.mock import AsyncMock, MagicMock

from routes import levels


def run(coro):
    return asyncio.run(coro)


def test_expired_level_activity_keeps_future_and_paused_subscriptions():
    today = '2026-10-01'
    assert levels._is_expired_level_activity({'status': 'active', 'end_date': '2026-09-30'}, today)
    assert levels._is_expired_level_activity({'status': 'expired'}, today)
    assert not levels._is_expired_level_activity({'status': 'pending', 'end_date': '2026-10-15'}, today)
    assert not levels._is_expired_level_activity({'status': 'paused', 'end_date': '2026-10-15'}, today)
    assert not levels._is_expired_level_activity({'status': 'expired', 'end_date': '2026-10-15'}, today)
    assert not levels._is_expired_level_activity({'status': 'active', 'end_date': today}, today)
    assert not levels._is_expired_level_activity({'status': 'expired', 'end_date': '1'}, today)


def test_expired_cleanup_unlinks_only_expired_activity(monkeypatch):
    level_rows = MagicMock()
    level_rows.to_list = AsyncMock(return_value=[{'id': 'level-1', 'members': ['member-1']}])
    level_collection = MagicMock()
    level_collection.find.return_value = level_rows
    level_collection.update_one = AsyncMock()

    member_rows = MagicMock()
    member_rows.to_list = AsyncMock(return_value=[{
        'id': 'member-1', 'activities': [
            {'level_id': 'level-1', 'status': 'expired', 'end_date': '2020-01-01'},
            {'level_id': 'level-2', 'status': 'active', 'end_date': '2099-01-01'},
        ],
    }])
    remaining_rows = MagicMock()
    remaining_rows.to_list = AsyncMock(return_value=[])
    member_collection = MagicMock()
    member_collection.find.side_effect = [member_rows, remaining_rows]
    member_collection.update_one = AsyncMock()

    monkeypatch.setattr(levels, 'db', MagicMock(levels=level_collection, members=member_collection))
    monkeypatch.setattr(levels, 'resolve_branch_filter', lambda *_: None)
    monkeypatch.setattr(levels, 'cache_invalidate', lambda *_: None)

    result = run(levels.cleanup_expired_subscriptions(
        dry_run=False, branch_filter=None, level_id=None, current_user={'is_admin': True}))

    assert result['links_removed'] == 1
    saved = member_collection.update_one.await_args.args[1]['$set']['activities']
    assert saved[0]['level_id'] is None
    assert saved[1]['level_id'] == 'level-2'
    level_collection.update_one.assert_awaited_once()


def test_daily_level_cleanup_runs_for_each_active_tenant(monkeypatch):
    import server
    import utils.tenant as tenant_mod

    cleanup = AsyncMock(return_value={'members_affected': 2, 'links_removed': 3})
    monkeypatch.setattr(levels, 'cleanup_expired_subscriptions', cleanup)

    async def each_tenant(callback, *, label):
        assert label == 'expired_level_cleanup'
        result = await callback({'slug': 'academy'})
        return {'processed': 1, 'failed': 0, 'results': {'academy': result}}

    monkeypatch.setattr(tenant_mod, 'for_each_active_tenant', each_tenant)
    summary = run(server._run_expired_level_cleanup())

    assert summary['results']['academy']['links_removed'] == 3
    cleanup.assert_awaited_once_with(
        dry_run=False, branch_filter=None, level_id=None,
        current_user={'is_admin': True, 'branch_id': None},
    )
