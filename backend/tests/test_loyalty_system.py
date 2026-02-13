"""
نظام الولاء - Loyalty System Tests
====================================
Tests for loyalty points, rewards, levels, and redemptions
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestLoyaltySettings:
    """Test loyalty settings endpoints"""
    
    def test_get_points_settings(self):
        """GET /api/loyalty/settings/points - Get points earning settings"""
        response = requests.get(f"{BASE_URL}/api/loyalty/settings/points")
        assert response.status_code == 200
        data = response.json()
        
        # Verify all expected fields exist
        expected_fields = [
            'attendance_points', 'streak_5_days_bonus', 'streak_10_days_bonus',
            'monthly_renewal_points', 'quarterly_renewal_points', 'yearly_renewal_points',
            'referral_points', 'coach_rating_points', 'video_watch_points', 'birthday_points'
        ]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
            assert isinstance(data[field], int), f"Field {field} should be int"
        
        print(f"✅ Points settings retrieved: {data}")
    
    def test_get_level_settings(self):
        """GET /api/loyalty/settings/levels - Get membership level settings"""
        response = requests.get(f"{BASE_URL}/api/loyalty/settings/levels")
        assert response.status_code == 200
        data = response.json()
        
        # Verify level thresholds
        expected_fields = ['bronze_min', 'silver_min', 'gold_min', 'diamond_min',
                          'silver_discount', 'gold_discount', 'diamond_discount']
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        # Verify level order
        assert data['bronze_min'] < data['silver_min'] < data['gold_min'] < data['diamond_min']
        
        print(f"✅ Level settings retrieved: {data}")


class TestLoyaltyRewards:
    """Test rewards CRUD operations"""
    
    @pytest.fixture
    def auth_token(self):
        """Get admin authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json()['access_token']
    
    def test_get_rewards_public(self):
        """GET /api/loyalty/rewards - Get all rewards (public)"""
        response = requests.get(f"{BASE_URL}/api/loyalty/rewards")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ Rewards list retrieved: {len(data)} rewards")
    
    def test_get_rewards_active_only(self):
        """GET /api/loyalty/rewards?active_only=true - Get active rewards only"""
        response = requests.get(f"{BASE_URL}/api/loyalty/rewards?active_only=true")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # All returned rewards should be active
        for reward in data:
            assert reward.get('is_active', True) == True
        print(f"✅ Active rewards retrieved: {len(data)} rewards")
    
    def test_create_reward(self, auth_token):
        """POST /api/loyalty/rewards - Create a new reward"""
        reward_data = {
            "name_ar": "خصم 10% على التجديد",
            "name_en": "10% Renewal Discount",
            "description_ar": "خصم 10% على أي تجديد اشتراك",
            "description_en": "10% discount on any subscription renewal",
            "points_required": 500,
            "reward_type": "discount",
            "discount_percentage": 10.0,
            "quantity_available": -1,
            "is_active": True
        }
        
        response = requests.post(
            f"{BASE_URL}/api/loyalty/rewards",
            json=reward_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert 'id' in data or 'message' in data
        print(f"✅ Reward created successfully")
        
        # Return reward ID for cleanup
        return data.get('id')
    
    def test_create_product_reward(self, auth_token):
        """POST /api/loyalty/rewards - Create a product reward"""
        reward_data = {
            "name_ar": "قميص الأكاديمية",
            "name_en": "Academy T-Shirt",
            "description_ar": "قميص رياضي بشعار الأكاديمية",
            "description_en": "Sports t-shirt with academy logo",
            "points_required": 1000,
            "reward_type": "product",
            "discount_percentage": 0,
            "quantity_available": 50,
            "is_active": True
        }
        
        response = requests.post(
            f"{BASE_URL}/api/loyalty/rewards",
            json=reward_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        print(f"✅ Product reward created successfully")


class TestMemberPoints:
    """Test member points operations"""
    
    @pytest.fixture
    def auth_token(self):
        """Get admin authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json()['access_token']
    
    @pytest.fixture
    def member_id(self, auth_token):
        """Get a valid member ID"""
        response = requests.get(
            f"{BASE_URL}/api/members?limit=1",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        members = response.json()
        if members:
            return members[0]['id']
        pytest.skip("No members available for testing")
    
    def test_get_member_points(self, member_id):
        """GET /api/loyalty/members/{member_id}/points - Get member points"""
        response = requests.get(f"{BASE_URL}/api/loyalty/members/{member_id}/points")
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert 'member_id' in data
        assert 'total_points' in data
        assert 'available_points' in data
        assert 'referral_code' in data
        assert 'level' in data
        assert 'level_ar' in data
        assert 'level_en' in data
        assert 'icon' in data
        
        print(f"✅ Member points retrieved: {data['total_points']} total, {data['available_points']} available")
        print(f"   Level: {data['level']} ({data['level_ar']})")
    
    def test_get_member_points_history(self, member_id):
        """GET /api/loyalty/members/{member_id}/history - Get points history"""
        response = requests.get(f"{BASE_URL}/api/loyalty/members/{member_id}/history?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ Points history retrieved: {len(data)} entries")
    
    def test_adjust_member_points(self, auth_token, member_id):
        """POST /api/loyalty/members/adjust - Manually adjust points"""
        adjustment_data = {
            "member_id": member_id,
            "points": 50,
            "reason": "مكافأة اختبار",
            "admin_notes": "Test adjustment"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/loyalty/members/adjust",
            json=adjustment_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert 'message' in data
        print(f"✅ Points adjusted: +50 points")
        
        # Verify points were added
        verify_response = requests.get(f"{BASE_URL}/api/loyalty/members/{member_id}/points")
        assert verify_response.status_code == 200
        verify_data = verify_response.json()
        assert verify_data['available_points'] >= 50
        print(f"   Verified: {verify_data['available_points']} available points")
    
    def test_adjust_member_points_negative(self, auth_token, member_id):
        """POST /api/loyalty/members/adjust - Deduct points"""
        adjustment_data = {
            "member_id": member_id,
            "points": -25,
            "reason": "خصم اختبار",
            "admin_notes": "Test deduction"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/loyalty/members/adjust",
            json=adjustment_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        print(f"✅ Points deducted: -25 points")
    
    def test_get_nonexistent_member_points(self):
        """GET /api/loyalty/members/{invalid_id}/points - Should return 404"""
        fake_id = str(uuid.uuid4())
        response = requests.get(f"{BASE_URL}/api/loyalty/members/{fake_id}/points")
        assert response.status_code == 404
        print(f"✅ Correctly returns 404 for non-existent member")


class TestLeaderboard:
    """Test leaderboard functionality"""
    
    def test_get_leaderboard(self):
        """GET /api/loyalty/leaderboard - Get top members"""
        response = requests.get(f"{BASE_URL}/api/loyalty/leaderboard?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        # Verify leaderboard structure
        for entry in data:
            assert 'rank' in entry
            assert 'member_id' in entry
            assert 'member_name' in entry
            assert 'total_points' in entry
            assert 'level' in entry
        
        # Verify ranking order
        for i in range(len(data) - 1):
            assert data[i]['total_points'] >= data[i + 1]['total_points']
        
        print(f"✅ Leaderboard retrieved: {len(data)} members")
        if data:
            print(f"   Top member: {data[0]['member_name']} with {data[0]['total_points']} points")


class TestBirthdayPoints:
    """Test birthday points processing"""
    
    def test_process_birthdays(self):
        """POST /api/loyalty/process-birthdays - Process birthday points"""
        response = requests.post(f"{BASE_URL}/api/loyalty/process-birthdays")
        assert response.status_code == 200
        data = response.json()
        
        assert 'message' in data
        assert 'birthdays_processed' in data
        assert isinstance(data['birthdays_processed'], int)
        
        print(f"✅ Birthday processing completed: {data['birthdays_processed']} birthdays processed")
    
    def test_get_today_birthdays(self):
        """GET /api/loyalty/birthdays/today - Get today's birthdays"""
        response = requests.get(f"{BASE_URL}/api/loyalty/birthdays/today")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        print(f"✅ Today's birthdays: {len(data)} members")


class TestLoyaltyStats:
    """Test loyalty statistics"""
    
    @pytest.fixture
    def auth_token(self):
        """Get admin authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json()['access_token']
    
    def test_get_loyalty_stats(self, auth_token):
        """GET /api/loyalty/stats - Get loyalty program statistics"""
        response = requests.get(
            f"{BASE_URL}/api/loyalty/stats",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify stats structure
        assert 'total_points_earned' in data
        assert 'total_points_available' in data
        assert 'total_points_redeemed' in data
        assert 'total_members_in_program' in data
        assert 'level_distribution' in data
        assert 'total_redemptions' in data
        assert 'pending_redemptions' in data
        
        # Verify level distribution
        level_dist = data['level_distribution']
        assert 'bronze' in level_dist
        assert 'silver' in level_dist
        assert 'gold' in level_dist
        assert 'diamond' in level_dist
        
        print(f"✅ Loyalty stats retrieved:")
        print(f"   Total points earned: {data['total_points_earned']}")
        print(f"   Members in program: {data['total_members_in_program']}")
        print(f"   Level distribution: {level_dist}")


class TestRedemptions:
    """Test reward redemption functionality"""
    
    @pytest.fixture
    def auth_token(self):
        """Get admin authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json()['access_token']
    
    def test_get_all_redemptions(self, auth_token):
        """GET /api/loyalty/redemptions - Get all redemption requests"""
        response = requests.get(
            f"{BASE_URL}/api/loyalty/redemptions",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ Redemptions list retrieved: {len(data)} requests")
    
    def test_get_redemptions_by_status(self, auth_token):
        """GET /api/loyalty/redemptions?status=pending - Filter by status"""
        response = requests.get(
            f"{BASE_URL}/api/loyalty/redemptions?status=pending",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # All returned should be pending
        for redemption in data:
            assert redemption.get('status') == 'pending'
        print(f"✅ Pending redemptions: {len(data)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
