from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from test_registration_followups import database, request_doc, run
from routes import registration_requests as routes
from services.registration_queue import enrich_queue


def test_family_key_normalizes_phone_but_isolates_branch_and_invalid_numbers():
    rows = [request_doc(), request_doc(id='sibling', customer_phone='+966501234567'),
            request_doc(id='other-branch', branch_id='b2'), request_doc(id='invalid1', customer_phone=''), request_doc(id='invalid2', customer_phone='')]
    enrich_queue(rows, datetime(2026, 1, 2, 9, tzinfo=timezone.utc))
    assert rows[0]['family_key'] == rows[1]['family_key']
    assert rows[0]['family_key'] != rows[2]['family_key']
    assert rows[3]['family_key'] != rows[4]['family_key']
    assert rows[0]['followup_overdue']
    assert rows[0]['next_followup_at'] == '2026-01-02T07:00:00+00:00'


def test_stopped_and_legacy_requests_have_no_next_send():
    rows = [request_doc(followup_status='stopped'), request_doc(id='legacy', followup_enrolled=False)]
    enrich_queue(rows)
    assert all(r['next_followup_at'] is None and not r['followup_overdue'] for r in rows)


def test_payment_stage_uses_real_invoice_and_overview_is_branch_scoped(database):
    database.registration_requests.rows.extend([request_doc(), request_doc(id='r2', branch_id='b2')])
    database.invoices.rows.append({'id': 'inv', 'registration_request_id': 'r1', 'branch_id': 'b1', 'status': 'pending'})
    rows = run(routes._normalize_registration_request_rows(database.registration_requests.rows))
    assert rows[0]['workflow_stage'] == 'awaiting_payment'
    database.invoices.rows[0]['status'] = 'paid'
    stats = run(routes.registration_queue_overview(branch_filter='b1', current_user={'is_admin': True}))
    assert stats['registered'] == 1 and stats['new'] == 0
    database.invoices.rows[0]['status'] = 'cancelled'
    rows = run(routes._normalize_registration_request_rows(database.registration_requests.rows))
    assert rows[0]['workflow_stage'] == 'new'


def test_assignment_rejects_foreign_branch_and_concurrent_change(database):
    database.registration_requests.rows.append(request_doc())
    database.users.rows.extend([{'id': 'u1', 'name': 'مسؤول', 'branch_id': 'b1'}, {'id': 'u2', 'branch_id': 'b2'}])
    admin = {'is_admin': True, 'name': 'الإدارة'}
    with pytest.raises(HTTPException) as error:
        run(routes.manage_registration_request('r1', routes.RegistrationManagementUpdate(assignee_id='u2'), admin))
    assert error.value.status_code == 400
    run(routes.manage_registration_request('r1', routes.RegistrationManagementUpdate(assignee_id='u1'), admin))
    assert database.registration_requests.rows[0]['assignee_id'] == 'u1'
    with pytest.raises(HTTPException) as error:
        run(routes.manage_registration_request('r1', routes.RegistrationManagementUpdate(assignee_id=None), admin))
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        run(routes.manage_registration_request('r1', routes.RegistrationManagementUpdate(assignee_id='u1', expected_assignee_id='u1'), {'branch_id': 'b2'}))
    assert error.value.status_code == 403
