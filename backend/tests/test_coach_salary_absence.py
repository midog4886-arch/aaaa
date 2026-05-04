"""
Coach Salary Absence Calculation Tests - اختبارات حساب الغياب التلقائي
Tests for: _compute_attendance_stats with different contract types,
           edge cases, and CoachBase model validation.
"""
import pytest
import requests
import os
import sys
import uuid
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from routes.coach_salaries import _compute_attendance_stats
from routes.coaches import CoachBase


class TestComputeAttendanceStatsUnit:
    """Unit tests for _compute_attendance_stats pure function"""

    def _make_coach(self, coach_id="c1", **overrides):
        base = {
            "id": coach_id,
            "expected_checkin_time": "09:00",
            "monthly_work_days": 30,
            "contract_type": "full_time",
        }
        base.update(overrides)
        return base

    def _make_records(self, coach_id="c1", present=0, leave=0, checked_out=0, checkin_times=None):
        records = []
        for i in range(present):
            r = {"coach_id": coach_id, "status": "present"}
            if checkin_times and i < len(checkin_times):
                r["check_in_time"] = checkin_times[i]
            records.append(r)
        for _ in range(checked_out):
            records.append({"coach_id": coach_id, "status": "checked_out"})
        for _ in range(leave):
            records.append({"coach_id": coach_id, "status": "leave"})
        return records

    def test_full_time_normal_attendance(self):
        coach = self._make_coach(contract_type="full_time", monthly_work_days=30)
        records = self._make_records(present=20, leave=2)
        result = _compute_attendance_stats(coach, records)
        assert result["contract_type"] == "full_time"
        assert result["monthly_work_days"] == 30
        assert result["present_days"] == 20
        assert result["leave_days"] == 2
        assert result["absent_days"] == 8

    def test_part_time_normal_attendance(self):
        coach = self._make_coach(contract_type="part_time", monthly_work_days=15)
        records = self._make_records(present=10, leave=1)
        result = _compute_attendance_stats(coach, records)
        assert result["contract_type"] == "part_time"
        assert result["monthly_work_days"] == 15
        assert result["present_days"] == 10
        assert result["leave_days"] == 1
        assert result["absent_days"] == 4

    def test_full_time_zero_present_days(self):
        coach = self._make_coach(contract_type="full_time", monthly_work_days=26)
        records = self._make_records(present=0, leave=0)
        result = _compute_attendance_stats(coach, records)
        assert result["present_days"] == 0
        assert result["leave_days"] == 0
        assert result["absent_days"] == 26

    def test_part_time_zero_present_days(self):
        coach = self._make_coach(contract_type="part_time", monthly_work_days=12)
        records = self._make_records(present=0, leave=0)
        result = _compute_attendance_stats(coach, records)
        assert result["present_days"] == 0
        assert result["absent_days"] == 12

    def test_present_exceeds_monthly_work_days(self):
        coach = self._make_coach(monthly_work_days=22)
        records = self._make_records(present=25, leave=0)
        result = _compute_attendance_stats(coach, records)
        assert result["present_days"] == 25
        assert result["absent_days"] == 0

    def test_leave_exceeds_monthly_work_days(self):
        coach = self._make_coach(monthly_work_days=20)
        records = self._make_records(present=0, leave=25)
        result = _compute_attendance_stats(coach, records)
        assert result["leave_days"] == 25
        assert result["absent_days"] == 0

    def test_present_plus_leave_exceeds_monthly_work_days(self):
        coach = self._make_coach(monthly_work_days=20)
        records = self._make_records(present=15, leave=10)
        result = _compute_attendance_stats(coach, records)
        assert result["present_days"] == 15
        assert result["leave_days"] == 10
        assert result["absent_days"] == 0

    def test_checked_out_counts_as_present(self):
        coach = self._make_coach(monthly_work_days=30)
        records = self._make_records(present=5, checked_out=10)
        result = _compute_attendance_stats(coach, records)
        assert result["present_days"] == 15
        assert result["absent_days"] == 15

    def test_legacy_coach_no_contract_type(self):
        coach = self._make_coach()
        del coach["contract_type"]
        records = self._make_records(present=20)
        result = _compute_attendance_stats(coach, records)
        assert result["contract_type"] == "full_time"

    def test_legacy_coach_none_contract_type(self):
        coach = self._make_coach(contract_type=None)
        records = self._make_records(present=20)
        result = _compute_attendance_stats(coach, records)
        assert result["contract_type"] == "full_time"

    def test_invalid_contract_type_defaults_to_full_time(self):
        coach = self._make_coach(contract_type="freelance")
        records = self._make_records(present=20)
        result = _compute_attendance_stats(coach, records)
        assert result["contract_type"] == "full_time"

    def test_legacy_coach_no_monthly_work_days(self):
        coach = self._make_coach()
        del coach["monthly_work_days"]
        records = self._make_records(present=20)
        result = _compute_attendance_stats(coach, records)
        assert result["monthly_work_days"] == 30
        assert result["absent_days"] == 10

    def test_legacy_coach_none_monthly_work_days(self):
        coach = self._make_coach(monthly_work_days=None)
        records = self._make_records(present=20)
        result = _compute_attendance_stats(coach, records)
        assert result["monthly_work_days"] == 30

    def test_monthly_work_days_zero_clamped_to_1(self):
        coach = self._make_coach(monthly_work_days=0)
        records = self._make_records(present=0)
        result = _compute_attendance_stats(coach, records)
        assert result["monthly_work_days"] == 1

    def test_monthly_work_days_clamped_to_maximum_31(self):
        coach = self._make_coach(monthly_work_days=50)
        records = self._make_records(present=0)
        result = _compute_attendance_stats(coach, records)
        assert result["monthly_work_days"] == 31

    def test_monthly_work_days_negative_clamped(self):
        coach = self._make_coach(monthly_work_days=-5)
        records = self._make_records(present=0)
        result = _compute_attendance_stats(coach, records)
        assert result["monthly_work_days"] == 1

    def test_monthly_work_days_string_value(self):
        coach = self._make_coach(monthly_work_days="22")
        records = self._make_records(present=10)
        result = _compute_attendance_stats(coach, records)
        assert result["monthly_work_days"] == 22
        assert result["absent_days"] == 12

    def test_monthly_work_days_invalid_string_defaults(self):
        coach = self._make_coach(monthly_work_days="abc")
        records = self._make_records(present=10)
        result = _compute_attendance_stats(coach, records)
        assert result["monthly_work_days"] == 30

    def test_late_minutes_calculated(self):
        coach = self._make_coach(expected_checkin_time="09:00")
        records = self._make_records(present=2, checkin_times=["09:15", "09:30"])
        result = _compute_attendance_stats(coach, records)
        assert result["late_minutes"] == 45

    def test_early_checkin_no_late_minutes(self):
        coach = self._make_coach(expected_checkin_time="09:00")
        records = self._make_records(present=2, checkin_times=["08:30", "08:45"])
        result = _compute_attendance_stats(coach, records)
        assert result["late_minutes"] == 0

    def test_on_time_checkin_no_late_minutes(self):
        coach = self._make_coach(expected_checkin_time="09:00")
        records = self._make_records(present=1, checkin_times=["09:00"])
        result = _compute_attendance_stats(coach, records)
        assert result["late_minutes"] == 0

    def test_invalid_threshold_defaults_to_0900(self):
        coach = self._make_coach(expected_checkin_time="invalid")
        records = self._make_records(present=1, checkin_times=["09:30"])
        result = _compute_attendance_stats(coach, records)
        assert result["threshold"] == "09:00"
        assert result["late_minutes"] == 30

    def test_no_threshold_defaults_to_0900(self):
        coach = self._make_coach()
        del coach["expected_checkin_time"]
        records = self._make_records(present=1, checkin_times=["09:15"])
        result = _compute_attendance_stats(coach, records)
        assert result["threshold"] == "09:00"
        assert result["late_minutes"] == 15

    def test_records_for_other_coaches_ignored(self):
        coach = self._make_coach(coach_id="c1", monthly_work_days=30)
        records = [
            {"coach_id": "c1", "status": "present"},
            {"coach_id": "c2", "status": "present"},
            {"coach_id": "c2", "status": "present"},
            {"coach_id": "c1", "status": "leave"},
        ]
        result = _compute_attendance_stats(coach, records)
        assert result["present_days"] == 1
        assert result["leave_days"] == 1
        assert result["absent_days"] == 28

    def test_no_records_at_all(self):
        coach = self._make_coach(monthly_work_days=22)
        result = _compute_attendance_stats(coach, [])
        assert result["present_days"] == 0
        assert result["leave_days"] == 0
        assert result["absent_days"] == 22

    def test_missing_check_in_time_no_late(self):
        coach = self._make_coach(expected_checkin_time="09:00")
        records = [{"coach_id": "c1", "status": "present"}]
        result = _compute_attendance_stats(coach, records)
        assert result["present_days"] == 1
        assert result["late_minutes"] == 0

    def test_full_time_all_days_present(self):
        coach = self._make_coach(contract_type="full_time", monthly_work_days=26)
        records = self._make_records(present=26)
        result = _compute_attendance_stats(coach, records)
        assert result["absent_days"] == 0

    def test_part_time_all_days_present(self):
        coach = self._make_coach(contract_type="part_time", monthly_work_days=15)
        records = self._make_records(present=15)
        result = _compute_attendance_stats(coach, records)
        assert result["absent_days"] == 0

    def test_part_time_over_attendance(self):
        coach = self._make_coach(contract_type="part_time", monthly_work_days=10)
        records = self._make_records(present=15)
        result = _compute_attendance_stats(coach, records)
        assert result["present_days"] == 15
        assert result["absent_days"] == 0


class TestCoachBaseValidation:
    """Unit tests for CoachBase model validation"""

    def _valid_coach_data(self, **overrides):
        base = {
            "name": "Test Coach",
            "name_ar": "مدرب اختبار",
            "phone": "0500000000",
        }
        base.update(overrides)
        return base

    def test_valid_full_time_coach(self):
        data = self._valid_coach_data(contract_type="full_time", monthly_work_days=26)
        coach = CoachBase(**data)
        assert coach.contract_type == "full_time"
        assert coach.monthly_work_days == 26

    def test_valid_part_time_coach(self):
        data = self._valid_coach_data(contract_type="part_time", monthly_work_days=15)
        coach = CoachBase(**data)
        assert coach.contract_type == "part_time"
        assert coach.monthly_work_days == 15

    def test_default_contract_type_is_full_time(self):
        data = self._valid_coach_data()
        coach = CoachBase(**data)
        assert coach.contract_type == "full_time"

    def test_default_monthly_work_days_is_30(self):
        data = self._valid_coach_data()
        coach = CoachBase(**data)
        assert coach.monthly_work_days == 30

    def test_invalid_contract_type_rejected(self):
        data = self._valid_coach_data(contract_type="freelance")
        with pytest.raises(Exception):
            CoachBase(**data)

    def test_monthly_work_days_zero_clamped_to_1(self):
        data = self._valid_coach_data(monthly_work_days=0)
        coach = CoachBase(**data)
        assert coach.monthly_work_days == 1

    def test_monthly_work_days_negative_clamped_to_1(self):
        data = self._valid_coach_data(monthly_work_days=-10)
        coach = CoachBase(**data)
        assert coach.monthly_work_days == 1

    def test_monthly_work_days_over_31_clamped(self):
        data = self._valid_coach_data(monthly_work_days=45)
        coach = CoachBase(**data)
        assert coach.monthly_work_days == 31

    def test_monthly_work_days_exactly_1(self):
        data = self._valid_coach_data(monthly_work_days=1)
        coach = CoachBase(**data)
        assert coach.monthly_work_days == 1

    def test_monthly_work_days_exactly_31(self):
        data = self._valid_coach_data(monthly_work_days=31)
        coach = CoachBase(**data)
        assert coach.monthly_work_days == 31

    def test_monthly_work_days_string_number(self):
        data = self._valid_coach_data(monthly_work_days="20")
        coach = CoachBase(**data)
        assert coach.monthly_work_days == 20

    def test_monthly_work_days_invalid_string_defaults_to_30(self):
        data = self._valid_coach_data(monthly_work_days="xyz")
        coach = CoachBase(**data)
        assert coach.monthly_work_days == 30

    def test_monthly_work_days_none_defaults_to_30(self):
        data = self._valid_coach_data(monthly_work_days=None)
        coach = CoachBase(**data)
        assert coach.monthly_work_days == 30

    def test_contract_type_none_allowed(self):
        data = self._valid_coach_data(contract_type=None)
        coach = CoachBase(**data)
        assert coach.contract_type is None or coach.contract_type == "full_time"


class TestSalaryDeductionCalculation:
    """Unit tests verifying salary deductions use absence correctly"""

    def test_full_time_salary_deduction(self):
        coach = {
            "id": "c1",
            "expected_checkin_time": "09:00",
            "monthly_work_days": 26,
            "contract_type": "full_time",
            "base_salary": 5000,
            "daily_deduction_rate": 100,
            "late_minute_rate": 2,
        }
        records = [{"coach_id": "c1", "status": "present"} for _ in range(20)]
        stats = _compute_attendance_stats(coach, records)
        deduction_absent = stats["absent_days"] * coach["daily_deduction_rate"]
        deduction_late = stats["late_minutes"] * coach["late_minute_rate"]
        net = coach["base_salary"] - deduction_absent - deduction_late
        assert stats["absent_days"] == 6
        assert deduction_absent == 600
        assert net == 4400

    def test_part_time_salary_deduction(self):
        coach = {
            "id": "c2",
            "expected_checkin_time": "09:00",
            "monthly_work_days": 15,
            "contract_type": "part_time",
            "base_salary": 3000,
            "daily_deduction_rate": 100,
            "late_minute_rate": 2,
        }
        records = [{"coach_id": "c2", "status": "present"} for _ in range(10)]
        stats = _compute_attendance_stats(coach, records)
        deduction_absent = stats["absent_days"] * coach["daily_deduction_rate"]
        net = coach["base_salary"] - deduction_absent
        assert stats["absent_days"] == 5
        assert deduction_absent == 500
        assert net == 2500

    def test_over_attendance_no_negative_deduction(self):
        coach = {
            "id": "c3",
            "expected_checkin_time": "09:00",
            "monthly_work_days": 20,
            "contract_type": "full_time",
            "base_salary": 4000,
            "daily_deduction_rate": 100,
            "late_minute_rate": 0,
        }
        records = [{"coach_id": "c3", "status": "present"} for _ in range(25)]
        stats = _compute_attendance_stats(coach, records)
        deduction_absent = stats["absent_days"] * coach["daily_deduction_rate"]
        net = coach["base_salary"] - deduction_absent
        assert stats["absent_days"] == 0
        assert deduction_absent == 0
        assert net == 4000

    def test_all_absent_full_deduction(self):
        coach = {
            "id": "c4",
            "expected_checkin_time": "09:00",
            "monthly_work_days": 22,
            "contract_type": "full_time",
            "base_salary": 5000,
            "daily_deduction_rate": 200,
            "late_minute_rate": 0,
        }
        stats = _compute_attendance_stats(coach, [])
        deduction_absent = stats["absent_days"] * coach["daily_deduction_rate"]
        net = coach["base_salary"] - deduction_absent
        assert stats["absent_days"] == 22
        assert deduction_absent == 4400
        assert net == 600

    def test_late_deduction_combined_with_absence(self):
        coach = {
            "id": "c5",
            "expected_checkin_time": "08:00",
            "monthly_work_days": 26,
            "contract_type": "full_time",
            "base_salary": 6000,
            "daily_deduction_rate": 150,
            "late_minute_rate": 5,
        }
        records = [
            {"coach_id": "c5", "status": "present", "check_in_time": "08:30"},
            {"coach_id": "c5", "status": "present", "check_in_time": "08:00"},
            {"coach_id": "c5", "status": "present", "check_in_time": "08:45"},
        ]
        for _ in range(17):
            records.append({"coach_id": "c5", "status": "present", "check_in_time": "08:00"})
        stats = _compute_attendance_stats(coach, records)
        assert stats["present_days"] == 20
        assert stats["absent_days"] == 6
        assert stats["late_minutes"] == 75
        deduction_absent = stats["absent_days"] * coach["daily_deduction_rate"]
        deduction_late = stats["late_minutes"] * coach["late_minute_rate"]
        net = coach["base_salary"] - deduction_absent - deduction_late
        assert deduction_absent == 900
        assert deduction_late == 375
        assert net == 4725


@pytest.mark.integration
class TestSalaryAPIIntegration:
    """Integration tests for salary computation via the API.
    These tests create coaches with deterministic attendance records
    and verify exact computed salary fields end-to-end."""

    TEST_MONTH = "2099-01"

    @pytest.fixture(autouse=True)
    def setup(self):
        self.base_url = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
        if not self.base_url:
            pytest.skip("REACT_APP_BACKEND_URL not set")
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        login_resp = self.session.post(f"{self.base_url}/api/auth/login", json={
            "username": "admin",
            "password": "admin123",
        })
        if login_resp.status_code != 200:
            pytest.skip("Cannot login to backend")
        token = login_resp.json().get("access_token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        self.created_coach_ids = []
        self.created_attendance_ids = []
        yield
        for att_id in self.created_attendance_ids:
            try:
                self.session.delete(f"{self.base_url}/api/coach-attendance/{att_id}")
            except Exception:
                pass
        for cid in self.created_coach_ids:
            try:
                self.session.delete(f"{self.base_url}/api/coaches/{cid}")
            except Exception:
                pass

    def _create_test_coach(self, contract_type="full_time", monthly_work_days=26,
                           base_salary=5000, daily_deduction_rate=100, late_minute_rate=2,
                           expected_checkin_time="09:00"):
        unique = str(uuid.uuid4())[:8]
        payload = {
            "name": f"TestCoach-{unique}",
            "name_ar": f"مدرب-{unique}",
            "phone": f"050{unique[:7]}",
            "contract_type": contract_type,
            "monthly_work_days": monthly_work_days,
            "base_salary": base_salary,
            "daily_deduction_rate": daily_deduction_rate,
            "late_minute_rate": late_minute_rate,
            "expected_checkin_time": expected_checkin_time,
        }
        resp = self.session.post(f"{self.base_url}/api/coaches", json=payload)
        assert resp.status_code == 200, f"Failed to create coach: {resp.text}"
        coach = resp.json()
        self.created_coach_ids.append(coach["id"])
        return coach

    def _checkin_coach(self, coach_id, date, check_in_time="08:00"):
        resp = self.session.post(f"{self.base_url}/api/coach-attendance/check-in", json={
            "coach_id": coach_id,
            "date": date,
            "check_in_time": check_in_time,
        })
        if resp.status_code == 200:
            rec = resp.json()
            self.created_attendance_ids.append(rec.get("id"))
        return resp

    def _get_salary_row(self, coach_id, month=None):
        month = month or self.TEST_MONTH
        resp = self.session.get(f"{self.base_url}/api/coach-salaries", params={"month": month})
        assert resp.status_code == 200, f"Salary list failed: {resp.text}"
        rows = resp.json().get("rows", [])
        return next((r for r in rows if r["coach_id"] == coach_id), None)

    def test_api_full_time_with_attendance(self):
        coach = self._create_test_coach(
            contract_type="full_time", monthly_work_days=26,
            base_salary=5000, daily_deduction_rate=100, late_minute_rate=0,
        )
        for day in range(1, 21):
            self._checkin_coach(coach["id"], f"{self.TEST_MONTH}-{day:02d}")

        row = self._get_salary_row(coach["id"])
        assert row is not None, "Coach salary row not found"
        assert row["contract_type"] == "full_time"
        assert row["monthly_work_days"] == 26
        assert row["present_days"] == 20
        assert row["absent_days"] == 6
        assert row["deduction_absent"] == 600
        expected_net = 5000 - 600
        assert row["net_amount"] == expected_net

    def test_api_part_time_with_attendance(self):
        coach = self._create_test_coach(
            contract_type="part_time", monthly_work_days=15,
            base_salary=3000, daily_deduction_rate=100, late_minute_rate=0,
        )
        for day in range(1, 11):
            self._checkin_coach(coach["id"], f"{self.TEST_MONTH}-{day:02d}")

        row = self._get_salary_row(coach["id"])
        assert row is not None, "Coach salary row not found"
        assert row["contract_type"] == "part_time"
        assert row["monthly_work_days"] == 15
        assert row["present_days"] == 10
        assert row["absent_days"] == 5
        assert row["deduction_absent"] == 500
        expected_net = 3000 - 500
        assert row["net_amount"] == expected_net

    def test_api_no_attendance_all_absent(self):
        coach = self._create_test_coach(
            contract_type="full_time", monthly_work_days=22,
            base_salary=4000, daily_deduction_rate=150, late_minute_rate=0,
        )
        row = self._get_salary_row(coach["id"])
        assert row is not None, "Coach salary row not found"
        assert row["present_days"] == 0
        assert row["absent_days"] == 22
        assert row["deduction_absent"] == 3300
        expected_net = 4000 - 3300
        assert row["net_amount"] == expected_net

    def test_api_late_deductions_computed(self):
        coach = self._create_test_coach(
            contract_type="full_time", monthly_work_days=26,
            base_salary=6000, daily_deduction_rate=100, late_minute_rate=5,
            expected_checkin_time="09:00",
        )
        self._checkin_coach(coach["id"], f"{self.TEST_MONTH}-01", "09:30")
        self._checkin_coach(coach["id"], f"{self.TEST_MONTH}-02", "09:15")
        self._checkin_coach(coach["id"], f"{self.TEST_MONTH}-03", "08:50")

        row = self._get_salary_row(coach["id"])
        assert row is not None
        assert row["present_days"] == 3
        assert row["absent_days"] == 23
        assert row["late_minutes"] == 45
        assert row["deduction_late"] == 225
        assert row["deduction_absent"] == 2300
        expected_net = 6000 - 2300 - 225
        assert row["net_amount"] == expected_net

    def test_api_invalid_contract_type_rejected(self):
        unique = str(uuid.uuid4())[:8]
        payload = {
            "name": f"TestCoach-{unique}",
            "name_ar": f"مدرب-{unique}",
            "phone": f"050{unique[:7]}",
            "contract_type": "invalid_type",
            "monthly_work_days": 20,
            "base_salary": 3000,
            "daily_deduction_rate": 100,
            "late_minute_rate": 2,
        }
        resp = self.session.post(f"{self.base_url}/api/coaches", json=payload)
        assert resp.status_code == 422, f"Expected 422 for invalid contract_type, got {resp.status_code}"

    def test_api_monthly_work_days_clamped(self):
        coach = self._create_test_coach(contract_type="full_time", monthly_work_days=50)
        assert coach["monthly_work_days"] == 31
