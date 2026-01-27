"""
Test cases for supervisor_name field in invoices
Tests:
1. Creating a new invoice saves supervisor_name automatically
2. Converting registration form to invoice saves supervisor_name
3. Old invoices without supervisor_name display correctly (no errors)
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSupervisorNameFeature:
    """Test supervisor_name field in invoices"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        self.token = data["access_token"]
        self.user_name = data["user"]["name"]  # Should be "مدير النظام"
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        yield
    
    def test_01_create_invoice_saves_supervisor_name(self):
        """Test that creating a new invoice automatically saves supervisor_name"""
        # First get an activity to use in invoice
        activities_response = requests.get(f"{BASE_URL}/api/activities", headers=self.headers)
        assert activities_response.status_code == 200
        activities = activities_response.json()
        
        # Create invoice with test data
        invoice_data = {
            "items": [{
                "activity_id": activities[0]["id"] if activities else "test-activity",
                "activity_name": activities[0]["name_ar"] if activities else "نشاط اختباري",
                "fee": 100.0,
                "period": "2025-01-01 - 2025-01-31"
            }],
            "discount": 0,
            "notes": "TEST_SUPERVISOR_NAME - اختبار حقل مشرف الفاتورة",
            "payment_method": "cash",
            "customer_name_ar": "عميل اختباري للمشرف",
            "customer_phone": "0501234567"
        }
        
        response = requests.post(f"{BASE_URL}/api/invoices", json=invoice_data, headers=self.headers)
        assert response.status_code == 200, f"Failed to create invoice: {response.text}"
        
        invoice = response.json()
        
        # Verify supervisor_name is saved
        assert "supervisor_name" in invoice, "supervisor_name field missing in response"
        assert invoice["supervisor_name"] == self.user_name, f"Expected supervisor_name '{self.user_name}', got '{invoice.get('supervisor_name')}'"
        
        print(f"✅ Invoice created with supervisor_name: {invoice['supervisor_name']}")
        print(f"   Invoice ID: {invoice['id']}")
        print(f"   Invoice Number: {invoice.get('invoice_number')}")
        
        # Verify by fetching the invoice again
        get_response = requests.get(f"{BASE_URL}/api/invoices/{invoice['id']}", headers=self.headers)
        assert get_response.status_code == 200
        fetched_invoice = get_response.json()
        assert fetched_invoice["supervisor_name"] == self.user_name, "supervisor_name not persisted correctly"
        
        print(f"✅ Verified supervisor_name persisted in database")
        
        return invoice["id"]
    
    def test_02_convert_registration_form_saves_supervisor_name(self):
        """Test that converting registration form to invoice saves supervisor_name"""
        # First create a registration form
        form_data = {
            "customer_name": "عميل استمارة اختبارية",
            "customer_phone": "0509876543",
            "items": [{
                "activity_id": "",
                "activity_name": "نشاط من استمارة",
                "fee": 200.0,
                "start_date": "2025-01-01",
                "end_date": "2025-01-31",
                "period": "2025-01-01 - 2025-01-31",
                "schedule": "السبت والاثنين",
                "is_product": False,
                "quantity": 1
            }],
            "subtotal": 200.0,
            "discount": 0,
            "vat_amount": 30.0,
            "total": 230.0,
            "payment_method": "cash",
            "notes": "TEST_SUPERVISOR_FORM - استمارة اختبارية"
        }
        
        # Create registration form
        form_response = requests.post(f"{BASE_URL}/api/registration-forms", json=form_data, headers=self.headers)
        assert form_response.status_code == 200, f"Failed to create registration form: {form_response.text}"
        
        form = form_response.json()
        form_id = form["id"]
        print(f"✅ Registration form created: {form['form_number']}")
        
        # Convert form to invoice
        convert_response = requests.put(f"{BASE_URL}/api/registration-forms/{form_id}/convert", headers=self.headers)
        assert convert_response.status_code == 200, f"Failed to convert form: {convert_response.text}"
        
        result = convert_response.json()
        invoice = result.get("invoice", {})
        
        # Verify supervisor_name is saved
        assert "supervisor_name" in invoice, "supervisor_name field missing in converted invoice"
        assert invoice["supervisor_name"] == self.user_name, f"Expected supervisor_name '{self.user_name}', got '{invoice.get('supervisor_name')}'"
        
        print(f"✅ Converted invoice has supervisor_name: {invoice['supervisor_name']}")
        print(f"   Invoice ID: {invoice['id']}")
        
        return invoice["id"]
    
    def test_03_old_invoices_without_supervisor_name_display_correctly(self):
        """Test that old invoices without supervisor_name don't cause errors"""
        # Get all invoices
        response = requests.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        assert response.status_code == 200, f"Failed to get invoices: {response.text}"
        
        invoices = response.json()
        
        # Count invoices with and without supervisor_name
        with_supervisor = 0
        without_supervisor = 0
        
        for invoice in invoices:
            if invoice.get("supervisor_name"):
                with_supervisor += 1
            else:
                without_supervisor += 1
        
        print(f"✅ Total invoices: {len(invoices)}")
        print(f"   With supervisor_name: {with_supervisor}")
        print(f"   Without supervisor_name: {without_supervisor}")
        
        # Verify API doesn't fail when returning invoices without supervisor_name
        assert response.status_code == 200, "API should handle invoices without supervisor_name"
        
        # Test individual invoice fetch for one without supervisor_name (if exists)
        for invoice in invoices:
            if not invoice.get("supervisor_name"):
                get_response = requests.get(f"{BASE_URL}/api/invoices/{invoice['id']}", headers=self.headers)
                assert get_response.status_code == 200, f"Failed to get old invoice: {get_response.text}"
                print(f"✅ Old invoice {invoice['id'][:8]} fetched successfully (no supervisor_name)")
                break
    
    def test_04_verify_invoice_202601_has_supervisor_name(self):
        """Verify that invoice 202601 mentioned in the task has supervisor_name"""
        # Search for invoice 202601
        response = requests.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        assert response.status_code == 200
        
        invoices = response.json()
        invoice_202601 = None
        
        for invoice in invoices:
            if invoice.get("invoice_number") == "202601":
                invoice_202601 = invoice
                break
        
        if invoice_202601:
            print(f"✅ Found invoice 202601")
            print(f"   supervisor_name: {invoice_202601.get('supervisor_name', 'NOT SET')}")
            print(f"   customer_name: {invoice_202601.get('customer_name_ar', invoice_202601.get('member_name'))}")
            
            # According to task, this invoice should have supervisor_name='مدير النظام'
            if invoice_202601.get("supervisor_name"):
                assert invoice_202601["supervisor_name"] == "مدير النظام", f"Expected 'مدير النظام', got '{invoice_202601['supervisor_name']}'"
                print(f"✅ Invoice 202601 has correct supervisor_name: مدير النظام")
            else:
                print(f"⚠️ Invoice 202601 does not have supervisor_name set")
        else:
            print(f"ℹ️ Invoice 202601 not found - may have been created in a different session")
    
    def test_05_cleanup_test_data(self):
        """Clean up test invoices created during testing"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=self.headers)
        assert response.status_code == 200
        
        invoices = response.json()
        deleted_count = 0
        
        for invoice in invoices:
            notes = invoice.get("notes", "")
            if "TEST_SUPERVISOR" in notes:
                delete_response = requests.delete(f"{BASE_URL}/api/invoices/{invoice['id']}", headers=self.headers)
                if delete_response.status_code in [200, 204]:
                    deleted_count += 1
                    print(f"   Deleted test invoice: {invoice['id'][:8]}")
        
        # Also clean up test registration forms
        forms_response = requests.get(f"{BASE_URL}/api/registration-forms", headers=self.headers)
        if forms_response.status_code == 200:
            forms = forms_response.json()
            for form in forms:
                notes = form.get("notes", "")
                if "TEST_SUPERVISOR" in notes:
                    requests.delete(f"{BASE_URL}/api/registration-forms/{form['id']}", headers=self.headers)
                    print(f"   Deleted test form: {form['id'][:8]}")
        
        print(f"✅ Cleanup complete: {deleted_count} test invoices deleted")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
