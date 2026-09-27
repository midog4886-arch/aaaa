import asyncio
import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import server


class Cursor:
    def __init__(self, rows, failed=False):
        self.rows, self.failed = rows, failed

    async def to_list(self, limit):
        if self.failed:
            raise RuntimeError('database unavailable')
        return self.rows if limit is None else self.rows[:limit]


class Database:
    def __init__(self, rows, failed=None):
        self.rows, self.failed = rows, failed

    def __getitem__(self, name):
        return SimpleNamespace(find=lambda *args: Cursor(self.rows.get(name, []), name == self.failed))


def test_backup_includes_registration_history_and_does_not_truncate(monkeypatch, tmp_path):
    rows = {'registration_requests': [{'id': 'request'}], 'whatsapp_cloud_messages': [{'id': str(n)} for n in range(100001)]}
    monkeypatch.setattr(server, 'db', Database(rows))
    monkeypatch.setattr(server, 'BACKUPS_DIR', tmp_path)
    send = AsyncMock(return_value={'status': 'unconfigured'})
    monkeypatch.setattr(server, '_send_backup_to_telegram', send)
    result = asyncio.run(server._backup_one_tenant({'slug': 'default'}))
    data = json.loads((tmp_path / result['file']).read_text())['collections']
    assert data['registration_requests'] == rows['registration_requests']
    assert len(data['whatsapp_cloud_messages']) == 100001
    assert result['skipped'] == 0


def test_read_failure_preserves_previous_backup_and_never_sends_partial_data(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'db', Database({}, failed='registration_requests'))
    monkeypatch.setattr(server, 'BACKUPS_DIR', tmp_path)
    prior = tmp_path / f"auto_backup_default_{server.datetime.now(server._RIYADH_TZ).strftime('%Y%m%d')}.json"
    prior.write_text('previous complete backup')
    send = AsyncMock()
    monkeypatch.setattr(server, '_send_backup_to_telegram', send)
    with pytest.raises(RuntimeError, match='Backup incomplete'):
        asyncio.run(server._backup_one_tenant({'slug': 'default'}))
    assert prior.read_text() == 'previous complete backup'
    send.assert_not_called()
