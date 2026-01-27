"""
Test cases for pending forms dashboard card and registration form features:
1. Dashboard stats API returns pending_forms_total and pending_forms_count
2. Registration form total calculation (without VAT)
3. Save registration form only (without printing)
4. Registration form header-banner design
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestDashboardPendingForms:
    """Test dashboard stats API for pending forms card"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_dashboard_stats_returns_pending_forms_fields(self):
        """Test that /api/dashboard/stats returns pending_forms_total and pending_forms_count"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=self.headers)
        assert response.status_code == 200, f"Dashboard stats failed: {response.text}"
        
        data = response.json()
        # Verify pending_forms_total field exists
        assert "pending_forms_total" in data, "pending_forms_total field missing from dashboard stats"
        # Verify pending_forms_count field exists
        assert "pending_forms_count" in data, "pending_forms_count field missing from dashboard stats"
        
        # Verify they are numeric values
        assert isinstance(data["pending_forms_total"], (int, float)), "pending_forms_total should be numeric"
        assert isinstance(data["pending_forms_count"], int), "pending_forms_count should be integer"
        
        print(f"✅ Dashboard stats: pending_forms_total={data['pending_forms_total']}, pending_forms_count={data['pending_forms_count']}")
    
    def test_dashboard_stats_pending_forms_count_matches_api(self):
        """Test that pending_forms_count matches actual pending registration forms"""
        # Get dashboard stats
        stats_response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=self.headers)
        assert stats_response.status_code == 200
        stats = stats_response.json()
        
        # Get actual pending registration forms
        forms_response = requests.get(f"{BASE_URL}/api/registration-forms?status=pending", headers=self.headers)
        assert forms_response.status_code == 200
        forms = forms_response.json()
        
        # Count pending forms
        pending_forms = [f for f in forms if f.get("status") == "pending"]
        
        # Verify count matches
        assert stats["pending_forms_count"] == len(pending_forms), \
            f"Count mismatch: stats={stats['pending_forms_count']}, actual={len(pending_forms)}"
        
        # Verify total matches
        actual_total = sum(f.get("total", 0) for f in pending_forms)
        assert abs(stats["pending_forms_total"] - actual_total) < 0.01, \
            f"Total mismatch: stats={stats['pending_forms_total']}, actual={actual_total}"
        
        print(f"✅ Pending forms count verified: {len(pending_forms)} forms, total={actual_total}")


class TestRegistrationFormCalculation:
    """Test registration form total calculation (without VAT)"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert response.status_code == 200
        self.token = response.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.created_form_id = None
    
    def teardown_method(self, method):
        """Cleanup created test data"""
        if self.created_form_id:
            try:
                requests.delete(f"{BASE_URL}/api/registration-forms/{self.created_form_id}", headers=self.headers)
            except:
                pass
    
    def test_registration_form_total_without_vat(self):
        """Test that registration form total = subtotal - discount (NO VAT)"""
        # Create a registration form
        form_data = {
            "customer_name": "TEST_Customer_NoVAT",
            "customer_phone": "0501234567",
            "items": [
                {
                    "activity_id": "",
                    "activity_name": "Test Activity",
                    "fee": 100.0,
                    "start_date": "2026-01-01",
                    "end_date": "2026-02-01",
                    "period": "2026-01-01 - 2026-02-01",
                    "schedule": "",
                    "is_product": False,
                    "quantity": 1
                }
            ],
            "subtotal": 100.0,
            "discount": 10.0,
            "discount_code": "",
            "vat_amount": 0,  # NO VAT for registration form
            "total": 90.0,   # subtotal - discount = 100 - 10 = 90 (NO VAT)
            "payment_method": "cash",
            "notes": "Test form for VAT verification"
        }
        
        response = requests.post(f"{BASE_URL}/api/registration-forms", json=form_data, headers=self.headers)
        assert response.status_code == 200, f"Create form failed: {response.text}"
        
        created_form = response.json()
        self.created_form_id = created_form["id"]
        
        # Verify total calculation: subtotal - discount (NO VAT)
        expected_total = form_data["subtotal"] - form_data["discount"]
        assert created_form["total"] == expected_total, \
            f"Total mismatch: expected={expected_total}, actual={created_form['total']}"
        
        # Verify VAT is 0
        assert created_form.get("vat_amount", 0) == 0, \
            f"VAT should be 0 for registration form, got {created_form.get('vat_amount')}"
        
        print(f"✅ Registration form total verified: subtotal={form_data['subtotal']}, discount={form_data['discount']}, total={created_form['total']} (NO VAT)")
    
    def test_registration_form_save_only(self):
        """Test that registration form can be saved without printing (API level)"""
        form_data = {
            "customer_name": "TEST_SaveOnly_Customer",
            "customer_phone": "0509876543",
            "items": [
                {
                    "activity_id": "",
                    "activity_name": "Swimming",
                    "fee": 200.0,
                    "start_date": "2026-01-15",
                    "end_date": "2026-02-15",
                    "period": "2026-01-15 - 2026-02-15",
                    "schedule": "السبت والاثنين 4-5 مساءً",
                    "is_product": False,
                    "quantity": 1
                }
            ],
            "subtotal": 200.0,
            "discount": 0,
            "discount_code": "",
            "vat_amount": 0,
            "total": 200.0,
            "payment_method": "card",
            "notes": "Test save only"
        }
        
        response = requests.post(f"{BASE_URL}/api/registration-forms", json=form_data, headers=self.headers)
        assert response.status_code == 200, f"Save form failed: {response.text}"
        
        created_form = response.json()
        self.created_form_id = created_form["id"]
        
        # Verify form was saved with correct data
        assert created_form["customer_name"] == form_data["customer_name"]
        assert created_form["customer_phone"] == form_data["customer_phone"]
        assert created_form["status"] == "pending"
        assert len(created_form["items"]) == 1
        
        # Verify we can retrieve the saved form
        get_response = requests.get(f"{BASE_URL}/api/registration-forms/{created_form['id']}", headers=self.headers)
        assert get_response.status_code == 200
        
        retrieved_form = get_response.json()
        assert retrieved_form["customer_name"] == form_data["customer_name"]
        
        print(f"✅ Registration form saved successfully: id={created_form['id']}, form_number={created_form.get('form_number')}")


class TestRegistrationFormsAPI:
    """Test registration forms API endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert response.status_code == 200
        self.token = response.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_registration_forms_list(self):
        """Test GET /api/registration-forms returns list"""
        response = requests.get(f"{BASE_URL}/api/registration-forms", headers=self.headers)
        assert response.status_code == 200, f"Get forms failed: {response.text}"
        
        forms = response.json()
        assert isinstance(forms, list), "Response should be a list"
        
        print(f"✅ Registration forms list: {len(forms)} forms found")
    
    def test_get_pending_registration_forms(self):
        """Test filtering registration forms by status=pending"""
        response = requests.get(f"{BASE_URL}/api/registration-forms?status=pending", headers=self.headers)
        assert response.status_code == 200
        
        forms = response.json()
        # All returned forms should be pending
        for form in forms:
            assert form.get("status") == "pending", f"Form {form.get('id')} has status {form.get('status')}, expected pending"
        
        print(f"✅ Pending registration forms: {len(forms)} forms")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
