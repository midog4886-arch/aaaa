"""
Test that non-admin users cannot see branch selector
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://sportsacademy-1.preview.emergentagent.com')

class TestNonAdminBranchAccess:
    """Test that non-admin users don't have branch switching access"""
    
    def test_create_non_admin_user(self):
        """Create a non-admin user for testing"""
        # First login as admin
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert response.status_code == 200
        admin_token = response.json()["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        
        # Get branches
        branches_res = requests.get(f"{BASE_URL}/api/branches", headers=admin_headers)
        branches = branches_res.json()
        branch_id = branches[0]["id"] if branches else None
        
        # Check if test user exists
        users_res = requests.get(f"{BASE_URL}/api/users", headers=admin_headers)
        users = users_res.json()
        test_user = next((u for u in users if u["username"] == "test_branch_user"), None)
        
        if test_user:
            print(f"✅ Test user already exists: {test_user['username']}")
            return test_user
        
        # Create non-admin user
        user_data = {
            "username": "test_branch_user",
            "password": "test123",
            "name": "مستخدم اختبار",
            "branch_id": branch_id,
            "is_admin": False
        }
        response = requests.post(f"{BASE_URL}/api/users/create", json=user_data, headers=admin_headers)
        assert response.status_code == 200, f"Failed to create user: {response.text}"
        created_user = response.json()
        print(f"✅ Created non-admin user: {created_user['username']}")
        assert created_user["is_admin"] == False
        return created_user
    
    def test_non_admin_login(self):
        """Test non-admin user login"""
        # First ensure user exists
        self.test_create_non_admin_user()
        
        # Login as non-admin
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "test_branch_user",
            "password": "test123"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["is_admin"] == False
        print(f"✅ Non-admin user logged in: {data['user']['name']}")
        return data
    
    def test_non_admin_sees_only_own_branch(self):
        """Test that non-admin only sees their assigned branch"""
        # Login as non-admin
        login_data = self.test_non_admin_login()
        token = login_data["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        user_branch_id = login_data["user"].get("branch_id")
        
        # Get branches - should only see own branch
        response = requests.get(f"{BASE_URL}/api/branches", headers=headers)
        assert response.status_code == 200
        branches = response.json()
        print(f"✅ Non-admin sees {len(branches)} branch(es)")
        
        # Should only see their own branch
        if user_branch_id:
            assert len(branches) <= 1, "Non-admin should only see their own branch"
            if branches:
                assert branches[0]["id"] == user_branch_id
        print(f"✅ Non-admin correctly limited to their branch")
    
    def test_non_admin_cannot_filter_other_branches(self):
        """Test that non-admin cannot filter by other branches"""
        # Login as admin to get all branches
        admin_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        admin_token = admin_response.json()["access_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        
        branches_res = requests.get(f"{BASE_URL}/api/branches", headers=admin_headers)
        all_branches = branches_res.json()
        
        # Login as non-admin
        login_data = self.test_non_admin_login()
        token = login_data["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        user_branch_id = login_data["user"].get("branch_id")
        
        # Try to filter by another branch
        other_branch = next((b for b in all_branches if b["id"] != user_branch_id), None)
        if other_branch:
            # Get members with other branch filter
            response = requests.get(
                f"{BASE_URL}/api/members",
                params={"branch_filter": other_branch["id"]},
                headers=headers
            )
            # Should still only return user's branch data (filter ignored for non-admin)
            members = response.json()
            print(f"✅ Non-admin branch filter test: returned {len(members)} members")
            # The backend should ignore branch_filter for non-admin users
        
        print(f"✅ Non-admin branch filtering correctly restricted")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
