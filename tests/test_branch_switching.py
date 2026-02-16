"""
Test Branch Switching Feature for Admin
Tests:
1. Dashboard stats filtering by branch
2. Members filtering by branch
3. Invoices filtering by branch
4. Discounts/Coupons filtering by branch
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://academy-manager-30.preview.emergentagent.com')

class TestBranchSwitching:
    """Test branch switching feature for admin"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin and get token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        self.token = data["access_token"]
        self.user = data["user"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        
        # Verify user is admin
        assert self.user.get("is_admin") == True, "User is not admin"
        print(f"✅ Logged in as admin: {self.user['name']}")
    
    def test_get_all_branches(self):
        """Test getting all branches for admin"""
        response = requests.get(f"{BASE_URL}/api/branches", headers=self.headers)
        assert response.status_code == 200
        branches = response.json()
        assert len(branches) > 0, "No branches found"
        print(f"✅ Found {len(branches)} branches:")
        for b in branches:
            print(f"   - {b['name_ar']} (ID: {b['id'][:8]}...)")
        self.branches = branches
        return branches
    
    def test_dashboard_stats_all_branches(self):
        """Test dashboard stats without branch filter (all branches)"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=self.headers)
        assert response.status_code == 200
        stats = response.json()
        print(f"✅ Dashboard stats (all branches):")
        print(f"   - Members: {stats.get('members_count', 0)}")
        print(f"   - Active subscriptions: {stats.get('active_subscriptions', 0)}")
        print(f"   - Month revenue: {stats.get('month_revenue', 0)}")
        print(f"   - Expiring count: {stats.get('expiring_count', 0)}")
        return stats
    
    def test_dashboard_stats_specific_branch(self):
        """Test dashboard stats with specific branch filter"""
        # First get branches
        branches = self.test_get_all_branches()
        
        for branch in branches[:2]:  # Test first 2 branches
            response = requests.get(
                f"{BASE_URL}/api/dashboard/stats",
                params={"branch_filter": branch["id"]},
                headers=self.headers
            )
            assert response.status_code == 200
            stats = response.json()
            print(f"✅ Dashboard stats for '{branch['name_ar']}':")
            print(f"   - Members: {stats.get('members_count', 0)}")
            print(f"   - Active subscriptions: {stats.get('active_subscriptions', 0)}")
            print(f"   - Month revenue: {stats.get('month_revenue', 0)}")
    
    def test_members_filter_by_branch(self):
        """Test members filtering by branch"""
        branches = self.test_get_all_branches()
        
        # Get all members first
        response = requests.get(f"{BASE_URL}/api/members", headers=self.headers)
        assert response.status_code == 200
        all_members = response.json()
        print(f"✅ Total members (all branches): {len(all_members)}")
        
        # Get members for specific branch
        for branch in branches[:2]:
            response = requests.get(
                f"{BASE_URL}/api/members",
                params={"branch_filter": branch["id"]},
                headers=self.headers
            )
            assert response.status_code == 200
            branch_members = response.json()
            print(f"✅ Members for '{branch['name_ar']}': {len(branch_members)}")
    
    def test_invoices_filter_by_branch(self):
        """Test invoices filtering by branch"""
        branches = self.test_get_all_branches()
        
        # Get all invoices first
        response = requests.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        assert response.status_code == 200
        all_invoices = response.json()
        print(f"✅ Total invoices (all branches): {len(all_invoices)}")
        
        # Get invoices for specific branch
        for branch in branches[:2]:
            response = requests.get(
                f"{BASE_URL}/api/invoices",
                params={"branch_filter": branch["id"]},
                headers=self.headers
            )
            assert response.status_code == 200
            branch_invoices = response.json()
            print(f"✅ Invoices for '{branch['name_ar']}': {len(branch_invoices)}")
    
    def test_discounts_filter_by_branch(self):
        """Test discounts/coupons filtering by branch"""
        branches = self.test_get_all_branches()
        
        # Get all discounts first
        response = requests.get(f"{BASE_URL}/api/discounts", headers=self.headers)
        assert response.status_code == 200
        all_discounts = response.json()
        print(f"✅ Total discounts (all branches): {len(all_discounts)}")
        for d in all_discounts:
            branch_name = "Global" if not d.get("branch_id") else d.get("branch_id")[:8]
            print(f"   - {d['code']}: branch={branch_name}")
        
        # Get discounts for specific branch
        for branch in branches[:2]:
            response = requests.get(
                f"{BASE_URL}/api/discounts",
                params={"branch_filter": branch["id"]},
                headers=self.headers
            )
            assert response.status_code == 200
            branch_discounts = response.json()
            print(f"✅ Discounts for '{branch['name_ar']}': {len(branch_discounts)}")
    
    def test_create_coupon_with_branch(self):
        """Test creating a coupon with specific branch"""
        branches = self.test_get_all_branches()
        target_branch = branches[0]  # Use first branch
        
        coupon_data = {
            "code": "TEST_BRANCH_COUPON",
            "name_ar": "كوبون اختبار الفرع",
            "name": "Test Branch Coupon",
            "discount_type": "percentage",
            "value": 10,
            "min_purchase": 0,
            "max_uses": 100,
            "is_active": True,
            "branch_id": target_branch["id"]
        }
        
        # Delete if exists
        response = requests.get(f"{BASE_URL}/api/discounts", headers=self.headers)
        existing = [d for d in response.json() if d["code"] == "TEST_BRANCH_COUPON"]
        for d in existing:
            requests.delete(f"{BASE_URL}/api/discounts/{d['id']}", headers=self.headers)
        
        # Create coupon
        response = requests.post(f"{BASE_URL}/api/discounts", json=coupon_data, headers=self.headers)
        assert response.status_code == 200, f"Failed to create coupon: {response.text}"
        created = response.json()
        print(f"✅ Created coupon '{created['code']}' for branch '{target_branch['name_ar']}'")
        assert created.get("branch_id") == target_branch["id"], "Branch ID not saved correctly"
        
        # Verify it appears when filtering by that branch
        response = requests.get(
            f"{BASE_URL}/api/discounts",
            params={"branch_filter": target_branch["id"]},
            headers=self.headers
        )
        branch_discounts = response.json()
        found = any(d["code"] == "TEST_BRANCH_COUPON" for d in branch_discounts)
        assert found, "Coupon not found when filtering by branch"
        print(f"✅ Coupon appears in branch filter results")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/discounts/{created['id']}", headers=self.headers)
        print(f"✅ Cleaned up test coupon")
    
    def test_products_filter_by_branch(self):
        """Test products filtering by branch"""
        branches = self.test_get_all_branches()
        
        # Get all products first
        response = requests.get(f"{BASE_URL}/api/products", headers=self.headers)
        assert response.status_code == 200
        all_products = response.json()
        print(f"✅ Total products (all branches): {len(all_products)}")
        
        # Get products for specific branch
        for branch in branches[:2]:
            response = requests.get(
                f"{BASE_URL}/api/products",
                params={"branch_filter": branch["id"]},
                headers=self.headers
            )
            assert response.status_code == 200
            branch_products = response.json()
            print(f"✅ Products for '{branch['name_ar']}': {len(branch_products)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
