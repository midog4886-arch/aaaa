"""
Attendance Module Backend Tests
Tests for: attendance tracking, bulk recording, QR check-in, reports
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAttendanceModule:
    """Attendance tracking system tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login to get token
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        
        token = login_response.json().get("access_token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Get activities for testing
        activities_response = self.session.get(f"{BASE_URL}/api/activities")
        assert activities_response.status_code == 200
        self.activities = activities_response.json()
        
        # Get members for testing
        members_response = self.session.get(f"{BASE_URL}/api/members?limit=10")
        assert members_response.status_code == 200
        self.members = members_response.json()
        
        self.today = datetime.now().strftime("%Y-%m-%d")
    
    def test_get_attendance_list(self):
        """Test GET /api/attendance - Get all attendance records"""
        response = self.session.get(f"{BASE_URL}/api/attendance")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ GET /api/attendance - Status: {response.status_code}, Records: {len(data)}")
    
    def test_get_attendance_by_activity(self):
        """Test GET /api/attendance/by-activity/{activity_id} - Get attendance for specific activity"""
        if not self.activities:
            pytest.skip("No activities available for testing")
        
        activity_id = self.activities[0]["id"]
        response = self.session.get(
            f"{BASE_URL}/api/attendance/by-activity/{activity_id}",
            params={"date": self.today}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Validate response structure
        assert "activity" in data
        assert "date" in data
        assert "members" in data
        assert "total_members" in data
        assert "present_count" in data
        assert "absent_count" in data
        
        print(f"✅ GET /api/attendance/by-activity - Activity: {data['activity'].get('name_ar', data['activity'].get('name'))}")
        print(f"   Members: {data['total_members']}, Present: {data['present_count']}, Absent: {data['absent_count']}")
    
    def test_get_attendance_by_activity_invalid_id(self):
        """Test GET /api/attendance/by-activity with invalid activity ID"""
        response = self.session.get(
            f"{BASE_URL}/api/attendance/by-activity/invalid-id-12345",
            params={"date": self.today}
        )
        assert response.status_code == 404
        print(f"✅ GET /api/attendance/by-activity (invalid ID) - Status: {response.status_code}")
    
    def test_record_single_attendance(self):
        """Test POST /api/attendance - Record single attendance"""
        if not self.activities or not self.members:
            pytest.skip("No activities or members available for testing")
        
        # Find a member with an activity
        member_with_activity = None
        activity_id = None
        for member in self.members:
            if member.get("activities"):
                member_with_activity = member
                activity_id = member["activities"][0]["activity_id"]
                break
        
        if not member_with_activity:
            pytest.skip("No member with activity found")
        
        payload = {
            "member_id": member_with_activity["id"],
            "activity_id": activity_id,
            "date": self.today,
            "status": "present",
            "notes": "TEST_attendance_record"
        }
        
        response = self.session.post(f"{BASE_URL}/api/attendance", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        # Validate response
        assert "message" in data or "id" in data
        print(f"✅ POST /api/attendance - Recorded attendance for member: {member_with_activity.get('name_ar', member_with_activity.get('name'))}")
    
    def test_record_bulk_attendance(self):
        """Test POST /api/attendance/bulk - Record bulk attendance"""
        if not self.activities:
            pytest.skip("No activities available for testing")
        
        # Get members for an activity
        activity_id = self.activities[0]["id"]
        by_activity_response = self.session.get(
            f"{BASE_URL}/api/attendance/by-activity/{activity_id}",
            params={"date": self.today}
        )
        
        if by_activity_response.status_code != 200:
            pytest.skip("Could not get activity members")
        
        members_data = by_activity_response.json().get("members", [])
        if not members_data:
            pytest.skip("No members enrolled in activity")
        
        # Create bulk attendance records
        records = []
        for member in members_data[:3]:  # Test with up to 3 members
            records.append({
                "member_id": member["member_id"],
                "status": "present",
                "notes": "TEST_bulk_attendance"
            })
        
        payload = {
            "activity_id": activity_id,
            "date": self.today,
            "records": records
        }
        
        response = self.session.post(f"{BASE_URL}/api/attendance/bulk", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        assert "count" in data or "message" in data
        print(f"✅ POST /api/attendance/bulk - Recorded {len(records)} attendance records")
    
    def test_qr_checkin(self):
        """Test POST /api/attendance/qr-checkin - QR code check-in"""
        if not self.members:
            pytest.skip("No members available for testing")
        
        # Find a member with an activity
        member_with_activity = None
        activity_id = None
        for member in self.members:
            if member.get("activities"):
                member_with_activity = member
                activity_id = member["activities"][0]["activity_id"]
                break
        
        if not member_with_activity:
            pytest.skip("No member with activity found")
        
        # QR check-in uses form data
        response = self.session.post(
            f"{BASE_URL}/api/attendance/qr-checkin",
            data={
                "member_id": member_with_activity["id"],
                "activity_id": activity_id
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Validate response structure
        assert "message" in data
        assert "member_name" in data
        assert "activity_name" in data
        print(f"✅ POST /api/attendance/qr-checkin - Member: {data['member_name']}, Already checked in: {data.get('already_checked_in', False)}")
    
    def test_qr_checkin_invalid_member(self):
        """Test POST /api/attendance/qr-checkin with invalid member"""
        if not self.activities:
            pytest.skip("No activities available for testing")
        
        response = self.session.post(
            f"{BASE_URL}/api/attendance/qr-checkin",
            data={
                "member_id": "invalid-member-id",
                "activity_id": self.activities[0]["id"]
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        
        assert response.status_code == 404
        print(f"✅ POST /api/attendance/qr-checkin (invalid member) - Status: {response.status_code}")
    
    def test_get_activity_report(self):
        """Test GET /api/attendance/activity/{activity_id}/report - Activity attendance report"""
        if not self.activities:
            pytest.skip("No activities available for testing")
        
        activity_id = self.activities[0]["id"]
        response = self.session.get(f"{BASE_URL}/api/attendance/activity/{activity_id}/report")
        
        assert response.status_code == 200
        data = response.json()
        
        # Validate response structure
        assert "activity" in data
        assert "total_records" in data
        assert "total_present" in data
        assert "total_absent" in data
        assert "member_stats" in data
        
        print(f"✅ GET /api/attendance/activity/{activity_id}/report")
        print(f"   Total records: {data['total_records']}, Present: {data['total_present']}, Absent: {data['total_absent']}")
    
    def test_get_member_report(self):
        """Test GET /api/attendance/member/{member_id}/report - Member attendance report"""
        if not self.members:
            pytest.skip("No members available for testing")
        
        member_id = self.members[0]["id"]
        response = self.session.get(f"{BASE_URL}/api/attendance/member/{member_id}/report")
        
        assert response.status_code == 200
        data = response.json()
        
        # Validate response structure
        assert "member" in data
        assert "records" in data
        assert "summary" in data
        
        print(f"✅ GET /api/attendance/member/{member_id}/report")
        print(f"   Summary: {data['summary']}")
    
    def test_attendance_with_date_filters(self):
        """Test GET /api/attendance with date filters"""
        response = self.session.get(
            f"{BASE_URL}/api/attendance",
            params={
                "start_date": "2026-01-01",
                "end_date": self.today
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ GET /api/attendance (with date filters) - Records: {len(data)}")
    
    def test_branches_api(self):
        """Test GET /api/branches - Required for attendance page"""
        response = self.session.get(f"{BASE_URL}/api/branches")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ GET /api/branches - Branches: {len(data)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
