import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from routes import level_certificates as certificates

class Collection:
    def __init__(self, rows): self.rows = rows; self.inserted = 0
    async def find_one(self, query, projection=None):
        return next((dict(row) for row in self.rows if all(row.get(k) == v for k, v in query.items())), None)
    async def create_index(self, *args, **kwargs): return None
    async def insert_one(self, row): self.rows.append(dict(row)); self.inserted += 1

class Cursor:
    def __init__(self, rows): self.rows = rows
    def sort(self, *args): return self
    async def to_list(self, *_): return self.rows

class AuditCollection(Collection):
    def find(self, query, projection=None):
        return Cursor([dict(r) for r in self.rows if all(r.get(k) == v for k, v in query.items())])

class LevelCollection(Collection):
    def find(self, query, projection=None):
        return Cursor([dict(r) for r in self.rows if r.get('id') in query['id']['$in']])

class CertificateCollection(Collection):
    def find(self, query, projection=None):
        return Cursor([dict(r) for r in self.rows if r.get('member_id') == query.get('member_id')])

@pytest.fixture
def fake_db(monkeypatch):
    audit = {'id':'audit-1','action':'level.transfer_member','entity_id':'m1','branch_id':'b1',
             'before':{'activity_id':'swim','level_id':'l1'},'after':{'activity_id':'swim','level_id':'l2'},
             'created_at':'2026-09-28T00:00:00+00:00'}
    store=SimpleNamespace(
        audit_logs=AuditCollection([audit]),
        members=Collection([{'id':'m1','branch_id':'b1','name_ar':'لاعب تجريبي'}]),
        users=Collection([{'id':'staff','name':'الموظف المعتمد'}]),
        levels=LevelCollection([{'id':'l1','branch_id':'b1','level_number':1,'activity_name':'السباحة'},
                                {'id':'l2','branch_id':'b1','level_number':2,'activity_name':'السباحة'}]),
        level_certificates=CertificateCollection([]))
    monkeypatch.setattr(certificates,'db',store)
    return store

def test_approval_issues_once_from_audited_promotion(fake_db):
    user={'is_admin':True,'user_id':'staff'}
    request=certificates.IssueCertificate(transfer_audit_id='audit-1',member_name_en='Test Player')
    first=asyncio.run(certificates.issue_certificate(request,user))
    second=asyncio.run(certificates.issue_certificate(request,user))
    assert first['id']==second['id']
    assert first['from_level_number']==1 and first['to_level_number']==2
    assert first['member_name_en']=='Test Player'
    assert fake_db.level_certificates.inserted==1
    assert fake_db.level_certificates.rows[0]['issued_by']=='staff'
    assert first['issued_by_name']=='الموظف المعتمد'
    assert first['seal_valid'] is True
    fake_db.level_certificates.rows[0]['member_name_en'] = 'Tampered Name'
    with pytest.raises(HTTPException) as exc:
        asyncio.run(certificates.verify_certificate(first['id']))
    assert exc.value.status_code == 404

def test_lateral_move_is_not_a_certificate(fake_db):
    fake_db.levels.rows[1]['level_number']=1
    user={'is_admin':True,'user_id':'staff'}
    result=asyncio.run(certificates.certificate_candidates('m1',user))
    assert result==[]
    with pytest.raises(HTTPException) as exc:
        asyncio.run(certificates.issue_certificate(certificates.IssueCertificate(transfer_audit_id='audit-1',member_name_en='Test Player'),user))
    assert exc.value.status_code==409
    assert fake_db.level_certificates.inserted==0
