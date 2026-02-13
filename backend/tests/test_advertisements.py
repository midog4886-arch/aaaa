"""
Advertisements API Tests - نظام الإعلانات
Tests for banners, videos (YouTube), and links advertisements system
"""
import pytest
import requests
import os
import re

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test data prefix for cleanup
TEST_PREFIX = "TEST_AD_"


class TestAdvertisementsAuth:
    """Authentication tests for advertisements endpoints"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json().get("access_token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    def test_get_all_ads_requires_auth(self):
        """GET /api/advertisements requires authentication"""
        response = requests.get(f"{BASE_URL}/api/advertisements")
        assert response.status_code == 403 or response.status_code == 401
    
    def test_get_public_ads_no_auth(self):
        """GET /api/advertisements/public is public endpoint"""
        response = requests.get(f"{BASE_URL}/api/advertisements/public")
        assert response.status_code == 200
        assert isinstance(response.json(), list)


class TestAdvertisementsCRUD:
    """CRUD operations for advertisements"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json().get("access_token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    def test_get_all_advertisements(self, auth_headers):
        """GET /api/advertisements - Get all advertisements (admin)"""
        response = requests.get(f"{BASE_URL}/api/advertisements", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✅ Found {len(data)} advertisements")
    
    def test_create_banner_advertisement(self, auth_headers):
        """POST /api/advertisements - Create banner advertisement"""
        ad_data = {
            "title": f"{TEST_PREFIX}Banner Ad",
            "title_ar": f"{TEST_PREFIX}إعلان بنر تجريبي",
            "ad_type": "banner",
            "position": "hero",
            "link_url": "https://example.com/banner",
            "banner_image_url": "",
            "description": "Test banner description",
            "description_ar": "وصف البنر التجريبي",
            "start_date": "2025-01-01",
            "end_date": "2025-12-31",
            "priority": 5,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert response.status_code == 200, f"Create failed: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert data["title_ar"] == ad_data["title_ar"]
        assert data["ad_type"] == "banner"
        assert data["position"] == "hero"
        assert data["views_count"] == 0
        assert data["clicks_count"] == 0
        print(f"✅ Created banner ad with ID: {data['id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{data['id']}", headers=auth_headers)
    
    def test_create_video_advertisement_with_youtube_url(self, auth_headers):
        """POST /api/advertisements - Create video ad with YouTube URL extraction"""
        ad_data = {
            "title": f"{TEST_PREFIX}Video Ad",
            "title_ar": f"{TEST_PREFIX}إعلان فيديو تجريبي",
            "ad_type": "video",
            "position": "inline",
            "link_url": "",
            "youtube_video_id": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "banner_image_url": "",
            "description": "Test video description",
            "description_ar": "وصف الفيديو التجريبي",
            "start_date": "",
            "end_date": "",
            "priority": 10,
            "is_active": True,
            "branch_id": None,
            "target_audience": "members"
        }
        
        response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert response.status_code == 200, f"Create failed: {response.text}"
        
        data = response.json()
        assert "id" in data
        # YouTube video ID should be extracted from URL
        assert data["youtube_video_id"] == "dQw4w9WgXcQ", f"Expected 'dQw4w9WgXcQ', got '{data['youtube_video_id']}'"
        assert data["ad_type"] == "video"
        print(f"✅ Created video ad with extracted YouTube ID: {data['youtube_video_id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{data['id']}", headers=auth_headers)
    
    def test_create_link_advertisement(self, auth_headers):
        """POST /api/advertisements - Create link advertisement"""
        ad_data = {
            "title": f"{TEST_PREFIX}Link Ad",
            "title_ar": f"{TEST_PREFIX}إعلان رابط تجريبي",
            "ad_type": "link",
            "position": "sidebar",
            "link_url": "https://example.com/promo",
            "youtube_video_id": "",
            "banner_image_url": "",
            "description": "Test link description",
            "description_ar": "وصف الرابط التجريبي",
            "start_date": "",
            "end_date": "",
            "priority": 3,
            "is_active": True,
            "branch_id": None,
            "target_audience": "guests"
        }
        
        response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert response.status_code == 200, f"Create failed: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert data["ad_type"] == "link"
        assert data["position"] == "sidebar"
        print(f"✅ Created link ad with ID: {data['id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{data['id']}", headers=auth_headers)
    
    def test_update_advertisement(self, auth_headers):
        """PUT /api/advertisements/{id} - Update advertisement"""
        # First create an ad
        ad_data = {
            "title": f"{TEST_PREFIX}Update Test",
            "title_ar": f"{TEST_PREFIX}اختبار التحديث",
            "ad_type": "banner",
            "position": "hero",
            "link_url": "",
            "youtube_video_id": "",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 1,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        create_response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert create_response.status_code == 200
        ad_id = create_response.json()["id"]
        
        # Update the ad
        update_data = {
            "title": f"{TEST_PREFIX}Updated Title",
            "title_ar": f"{TEST_PREFIX}عنوان محدث",
            "ad_type": "banner",
            "position": "sidebar",  # Changed position
            "link_url": "https://updated.com",
            "youtube_video_id": "",
            "banner_image_url": "",
            "description": "Updated description",
            "description_ar": "وصف محدث",
            "start_date": "2025-06-01",
            "end_date": "2025-12-31",
            "priority": 20,  # Changed priority
            "is_active": False,  # Changed status
            "branch_id": None,
            "target_audience": "members"
        }
        
        update_response = requests.put(f"{BASE_URL}/api/advertisements/{ad_id}", json=update_data, headers=auth_headers)
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        
        updated = update_response.json()
        assert updated["title_ar"] == update_data["title_ar"]
        assert updated["position"] == "sidebar"
        assert updated["priority"] == 20
        assert updated["is_active"] == False
        print(f"✅ Updated advertisement {ad_id}")
        
        # Verify with GET
        get_response = requests.get(f"{BASE_URL}/api/advertisements/{ad_id}", headers=auth_headers)
        assert get_response.status_code == 200
        fetched = get_response.json()
        assert fetched["position"] == "sidebar"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{ad_id}", headers=auth_headers)
    
    def test_delete_advertisement(self, auth_headers):
        """DELETE /api/advertisements/{id} - Delete advertisement"""
        # First create an ad
        ad_data = {
            "title": f"{TEST_PREFIX}Delete Test",
            "title_ar": f"{TEST_PREFIX}اختبار الحذف",
            "ad_type": "link",
            "position": "popup",
            "link_url": "",
            "youtube_video_id": "",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 0,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        create_response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert create_response.status_code == 200
        ad_id = create_response.json()["id"]
        
        # Delete the ad
        delete_response = requests.delete(f"{BASE_URL}/api/advertisements/{ad_id}", headers=auth_headers)
        assert delete_response.status_code == 200
        
        # Verify deletion
        get_response = requests.get(f"{BASE_URL}/api/advertisements/{ad_id}", headers=auth_headers)
        assert get_response.status_code == 404
        print(f"✅ Deleted advertisement {ad_id}")
    
    def test_toggle_advertisement_status(self, auth_headers):
        """PUT /api/advertisements/{id}/toggle - Toggle active status"""
        # First create an ad
        ad_data = {
            "title": f"{TEST_PREFIX}Toggle Test",
            "title_ar": f"{TEST_PREFIX}اختبار التبديل",
            "ad_type": "banner",
            "position": "hero",
            "link_url": "",
            "youtube_video_id": "",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 0,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        create_response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert create_response.status_code == 200
        ad_id = create_response.json()["id"]
        initial_status = create_response.json()["is_active"]
        
        # Toggle status
        toggle_response = requests.put(f"{BASE_URL}/api/advertisements/{ad_id}/toggle", headers=auth_headers)
        assert toggle_response.status_code == 200
        
        toggled = toggle_response.json()
        assert toggled["is_active"] != initial_status
        print(f"✅ Toggled ad status from {initial_status} to {toggled['is_active']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{ad_id}", headers=auth_headers)


class TestAdvertisementsPublic:
    """Public endpoints for advertisements (member portal)"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json().get("access_token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    def test_get_public_advertisements(self):
        """GET /api/advertisements/public - Get active ads for member portal"""
        response = requests.get(f"{BASE_URL}/api/advertisements/public")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # All returned ads should be active
        for ad in data:
            assert ad.get("is_active") == True
        
        print(f"✅ Found {len(data)} active public advertisements")
    
    def test_get_public_ads_by_position(self):
        """GET /api/advertisements/public?position=hero - Filter by position"""
        positions = ["hero", "sidebar", "inline", "popup"]
        
        for position in positions:
            response = requests.get(f"{BASE_URL}/api/advertisements/public", params={"position": position})
            assert response.status_code == 200
            
            data = response.json()
            for ad in data:
                assert ad.get("position") == position
            
            print(f"✅ Position '{position}': {len(data)} ads")
    
    def test_record_view(self, auth_headers):
        """POST /api/advertisements/{id}/view - Record view (public)"""
        # First create an ad
        ad_data = {
            "title": f"{TEST_PREFIX}View Test",
            "title_ar": f"{TEST_PREFIX}اختبار المشاهدة",
            "ad_type": "banner",
            "position": "hero",
            "link_url": "",
            "youtube_video_id": "",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 0,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        create_response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert create_response.status_code == 200
        ad_id = create_response.json()["id"]
        initial_views = create_response.json()["views_count"]
        
        # Record view (no auth required)
        view_response = requests.post(f"{BASE_URL}/api/advertisements/{ad_id}/view")
        assert view_response.status_code == 200
        assert view_response.json().get("success") == True
        
        # Verify view count increased
        get_response = requests.get(f"{BASE_URL}/api/advertisements/{ad_id}", headers=auth_headers)
        assert get_response.json()["views_count"] == initial_views + 1
        print(f"✅ View recorded, count: {get_response.json()['views_count']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{ad_id}", headers=auth_headers)
    
    def test_record_click(self, auth_headers):
        """POST /api/advertisements/{id}/click - Record click (public)"""
        # First create an ad
        ad_data = {
            "title": f"{TEST_PREFIX}Click Test",
            "title_ar": f"{TEST_PREFIX}اختبار النقر",
            "ad_type": "link",
            "position": "sidebar",
            "link_url": "https://example.com",
            "youtube_video_id": "",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 0,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        create_response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert create_response.status_code == 200
        ad_id = create_response.json()["id"]
        initial_clicks = create_response.json()["clicks_count"]
        
        # Record click (no auth required)
        click_response = requests.post(f"{BASE_URL}/api/advertisements/{ad_id}/click")
        assert click_response.status_code == 200
        assert click_response.json().get("success") == True
        
        # Verify click count increased
        get_response = requests.get(f"{BASE_URL}/api/advertisements/{ad_id}", headers=auth_headers)
        assert get_response.json()["clicks_count"] == initial_clicks + 1
        print(f"✅ Click recorded, count: {get_response.json()['clicks_count']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{ad_id}", headers=auth_headers)


class TestAdvertisementsStats:
    """Statistics endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json().get("access_token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    def test_get_stats_summary(self, auth_headers):
        """GET /api/advertisements/stats/summary - Get statistics"""
        response = requests.get(f"{BASE_URL}/api/advertisements/stats/summary", headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        
        # Verify all expected fields
        expected_fields = ["total_ads", "active_ads", "total_views", "total_clicks", 
                          "banners_count", "videos_count", "links_count", "ctr"]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        # CTR should be calculated correctly
        if data["total_views"] > 0:
            expected_ctr = round((data["total_clicks"] / data["total_views"]) * 100, 2)
            assert data["ctr"] == expected_ctr
        
        print(f"✅ Stats: {data['total_ads']} total, {data['active_ads']} active, CTR: {data['ctr']}%")


class TestYouTubeVideoIdExtraction:
    """Test YouTube video ID extraction from various URL formats"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json().get("access_token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    def test_youtube_standard_url(self, auth_headers):
        """Test standard YouTube URL: youtube.com/watch?v=VIDEO_ID"""
        ad_data = {
            "title": f"{TEST_PREFIX}YouTube Standard",
            "title_ar": f"{TEST_PREFIX}يوتيوب قياسي",
            "ad_type": "video",
            "position": "hero",
            "link_url": "",
            "youtube_video_id": "https://www.youtube.com/watch?v=abc123XYZ_-",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 0,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["youtube_video_id"] == "abc123XYZ_-"
        print("✅ Standard URL extraction works")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{response.json()['id']}", headers=auth_headers)
    
    def test_youtube_short_url(self, auth_headers):
        """Test short YouTube URL: youtu.be/VIDEO_ID"""
        ad_data = {
            "title": f"{TEST_PREFIX}YouTube Short",
            "title_ar": f"{TEST_PREFIX}يوتيوب قصير",
            "ad_type": "video",
            "position": "hero",
            "link_url": "",
            "youtube_video_id": "https://youtu.be/dQw4w9WgXcQ",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 0,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["youtube_video_id"] == "dQw4w9WgXcQ"
        print("✅ Short URL extraction works")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{response.json()['id']}", headers=auth_headers)
    
    def test_youtube_embed_url(self, auth_headers):
        """Test embed YouTube URL: youtube.com/embed/VIDEO_ID"""
        ad_data = {
            "title": f"{TEST_PREFIX}YouTube Embed",
            "title_ar": f"{TEST_PREFIX}يوتيوب مضمن",
            "ad_type": "video",
            "position": "hero",
            "link_url": "",
            "youtube_video_id": "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 0,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["youtube_video_id"] == "dQw4w9WgXcQ"
        print("✅ Embed URL extraction works")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{response.json()['id']}", headers=auth_headers)
    
    def test_youtube_video_id_only(self, auth_headers):
        """Test direct video ID: VIDEO_ID (11 characters)"""
        ad_data = {
            "title": f"{TEST_PREFIX}YouTube ID Only",
            "title_ar": f"{TEST_PREFIX}معرف يوتيوب فقط",
            "ad_type": "video",
            "position": "hero",
            "link_url": "",
            "youtube_video_id": "dQw4w9WgXcQ",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 0,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["youtube_video_id"] == "dQw4w9WgXcQ"
        print("✅ Direct video ID works")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{response.json()['id']}", headers=auth_headers)
    
    def test_youtube_shorts_url(self, auth_headers):
        """Test YouTube Shorts URL: youtube.com/shorts/VIDEO_ID"""
        ad_data = {
            "title": f"{TEST_PREFIX}YouTube Shorts",
            "title_ar": f"{TEST_PREFIX}يوتيوب شورتس",
            "ad_type": "video",
            "position": "hero",
            "link_url": "",
            "youtube_video_id": "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "banner_image_url": "",
            "description": "",
            "description_ar": "",
            "start_date": "",
            "end_date": "",
            "priority": 0,
            "is_active": True,
            "branch_id": None,
            "target_audience": "all"
        }
        
        response = requests.post(f"{BASE_URL}/api/advertisements", json=ad_data, headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["youtube_video_id"] == "dQw4w9WgXcQ"
        print("✅ Shorts URL extraction works")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/advertisements/{response.json()['id']}", headers=auth_headers)


class TestAdvertisementsFiltering:
    """Test filtering advertisements"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json().get("access_token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    def test_filter_by_ad_type(self, auth_headers):
        """GET /api/advertisements?ad_type=banner - Filter by type"""
        for ad_type in ["banner", "video", "link"]:
            response = requests.get(f"{BASE_URL}/api/advertisements", 
                                   params={"ad_type": ad_type}, 
                                   headers=auth_headers)
            assert response.status_code == 200
            
            data = response.json()
            for ad in data:
                assert ad.get("ad_type") == ad_type
            
            print(f"✅ Filter by type '{ad_type}': {len(data)} ads")
    
    def test_filter_by_position(self, auth_headers):
        """GET /api/advertisements?position=hero - Filter by position"""
        for position in ["hero", "sidebar", "inline", "popup"]:
            response = requests.get(f"{BASE_URL}/api/advertisements", 
                                   params={"position": position}, 
                                   headers=auth_headers)
            assert response.status_code == 200
            
            data = response.json()
            for ad in data:
                assert ad.get("position") == position
            
            print(f"✅ Filter by position '{position}': {len(data)} ads")
    
    def test_filter_active_only(self, auth_headers):
        """GET /api/advertisements?active_only=true - Filter active only"""
        response = requests.get(f"{BASE_URL}/api/advertisements", 
                               params={"active_only": "true"}, 
                               headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        for ad in data:
            assert ad.get("is_active") == True
        
        print(f"✅ Active only filter: {len(data)} ads")


class TestAdvertisementsErrorHandling:
    """Error handling tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "242456",
            "password": "242456"
        })
        assert response.status_code == 200
        return response.json().get("access_token")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get headers with auth token"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    def test_get_nonexistent_ad(self, auth_headers):
        """GET /api/advertisements/{id} - 404 for non-existent ad"""
        response = requests.get(f"{BASE_URL}/api/advertisements/nonexistent-id-12345", headers=auth_headers)
        assert response.status_code == 404
        print("✅ 404 returned for non-existent ad")
    
    def test_delete_nonexistent_ad(self, auth_headers):
        """DELETE /api/advertisements/{id} - 404 for non-existent ad"""
        response = requests.delete(f"{BASE_URL}/api/advertisements/nonexistent-id-12345", headers=auth_headers)
        assert response.status_code == 404
        print("✅ 404 returned for deleting non-existent ad")
    
    def test_view_nonexistent_ad(self):
        """POST /api/advertisements/{id}/view - 404 for non-existent ad"""
        response = requests.post(f"{BASE_URL}/api/advertisements/nonexistent-id-12345/view")
        assert response.status_code == 404
        print("✅ 404 returned for viewing non-existent ad")
    
    def test_click_nonexistent_ad(self):
        """POST /api/advertisements/{id}/click - 404 for non-existent ad"""
        response = requests.post(f"{BASE_URL}/api/advertisements/nonexistent-id-12345/click")
        assert response.status_code == 404
        print("✅ 404 returned for clicking non-existent ad")


# Cleanup fixture to remove test data after all tests
@pytest.fixture(scope="session", autouse=True)
def cleanup_test_ads():
    """Cleanup any remaining test advertisements after all tests"""
    yield
    
    # Login and cleanup
    login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "username": "242456",
        "password": "242456"
    })
    
    if login_response.status_code == 200:
        token = login_response.json().get("access_token")
        headers = {"Authorization": f"Bearer {token}"}
        
        # Get all ads and delete test ones
        ads_response = requests.get(f"{BASE_URL}/api/advertisements", headers=headers)
        if ads_response.status_code == 200:
            for ad in ads_response.json():
                if ad.get("title", "").startswith(TEST_PREFIX) or ad.get("title_ar", "").startswith(TEST_PREFIX):
                    requests.delete(f"{BASE_URL}/api/advertisements/{ad['id']}", headers=headers)
                    print(f"Cleaned up test ad: {ad['id']}")
