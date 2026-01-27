"""
Test Registration Forms View and Update Features
Tests for:
1. GET /api/registration-forms/{form_id} - View single form
2. PUT /api/registration-forms/{form_id} - Update form
3. Edit button only shows for pending forms
4. View button shows for all forms
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestRegistrationFormsViewUpdate:
    """Test registration forms view and update functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        self.token = response.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_all_registration_forms(self):
        """Test GET /api/registration-forms returns all forms"""
        response = requests.get(f"{BASE_URL}/api/registration-forms", headers=self.headers)
        assert response.status_code == 200
        forms = response.json()
        assert isinstance(forms, list)
        print(f"✅ GET /api/registration-forms returns {len(forms)} forms")
        
        # Check that forms have required fields
        for form in forms:
            assert "id" in form
            assert "form_number" in form
            assert "customer_name" in form
            assert "status" in form
            assert "items" in form
            print(f"  - Form {form['form_number']}: {form['customer_name']} ({form['status']})")
    
    def test_get_single_registration_form(self):
        """Test GET /api/registration-forms/{form_id} returns single form"""
        # First get all forms
        response = requests.get(f"{BASE_URL}/api/registration-forms", headers=self.headers)
        forms = response.json()
        
        if len(forms) == 0:
            pytest.skip("No registration forms available for testing")
        
        # Get the first form
        form_id = forms[0]["id"]
        response = requests.get(f"{BASE_URL}/api/registration-forms/{form_id}", headers=self.headers)
        assert response.status_code == 200
        
        form = response.json()
        assert form["id"] == form_id
        assert "customer_name" in form
        assert "customer_phone" in form
        assert "items" in form
        assert "subtotal" in form
        assert "total" in form
        print(f"✅ GET /api/registration-forms/{form_id} returns form details")
        print(f"  - Customer: {form['customer_name']}")
        print(f"  - Phone: {form.get('customer_phone', 'N/A')}")
        print(f"  - Total: {form['total']}")
    
    def test_get_nonexistent_form_returns_404(self):
        """Test GET /api/registration-forms/{form_id} returns 404 for non-existent form"""
        response = requests.get(f"{BASE_URL}/api/registration-forms/nonexistent-id", headers=self.headers)
        assert response.status_code == 404
        print("✅ GET non-existent form returns 404")
    
    def test_update_pending_registration_form(self):
        """Test PUT /api/registration-forms/{form_id} updates pending form"""
        # Get all forms and find a pending one
        response = requests.get(f"{BASE_URL}/api/registration-forms", headers=self.headers)
        forms = response.json()
        
        pending_forms = [f for f in forms if f["status"] == "pending"]
        if len(pending_forms) == 0:
            pytest.skip("No pending registration forms available for testing")
        
        form = pending_forms[0]
        form_id = form["id"]
        original_name = form["customer_name"]
        
        # Update the form
        update_data = {
            "customer_name": f"{original_name} - تم التعديل",
            "customer_phone": form.get("customer_phone", "0551234567"),
            "items": form["items"],
            "subtotal": form["subtotal"],
            "discount": form.get("discount", 0),
            "discount_code": form.get("discount_code", ""),
            "vat_amount": form.get("vat_amount", 0),
            "total": form["total"],
            "payment_method": form.get("payment_method", "cash"),
            "notes": "تم التعديل بواسطة الاختبار"
        }
        
        response = requests.put(f"{BASE_URL}/api/registration-forms/{form_id}", 
                               headers=self.headers, json=update_data)
        assert response.status_code == 200, f"Update failed: {response.text}"
        
        updated_form = response.json()
        assert "تم التعديل" in updated_form["customer_name"]
        assert updated_form["notes"] == "تم التعديل بواسطة الاختبار"
        print(f"✅ PUT /api/registration-forms/{form_id} updates form successfully")
        print(f"  - Updated name: {updated_form['customer_name']}")
        print(f"  - Updated notes: {updated_form['notes']}")
        
        # Verify the update persisted by fetching the form again
        response = requests.get(f"{BASE_URL}/api/registration-forms/{form_id}", headers=self.headers)
        assert response.status_code == 200
        fetched_form = response.json()
        assert "تم التعديل" in fetched_form["customer_name"]
        print("✅ Update persisted in database")
        
        # Restore original name
        update_data["customer_name"] = original_name
        update_data["notes"] = form.get("notes", "")
        requests.put(f"{BASE_URL}/api/registration-forms/{form_id}", 
                    headers=self.headers, json=update_data)
        print("✅ Restored original form data")
    
    def test_update_form_items(self):
        """Test updating form items (activities/products)"""
        # Get pending form
        response = requests.get(f"{BASE_URL}/api/registration-forms", headers=self.headers)
        forms = response.json()
        
        pending_forms = [f for f in forms if f["status"] == "pending"]
        if len(pending_forms) == 0:
            pytest.skip("No pending registration forms available for testing")
        
        form = pending_forms[0]
        form_id = form["id"]
        original_items = form["items"]
        
        # Add a new item
        new_items = original_items.copy()
        new_items.append({
            "activity_id": "test-activity",
            "product_id": "",
            "activity_name": "نشاط اختباري",
            "fee": 100,
            "start_date": "",
            "end_date": "",
            "period": "2025-01-01 - 2025-02-01",
            "schedule": "الأحد 4م",
            "is_product": False,
            "quantity": 1
        })
        
        new_subtotal = sum(item["fee"] * item.get("quantity", 1) for item in new_items)
        new_total = new_subtotal - form.get("discount", 0)
        
        update_data = {
            "customer_name": form["customer_name"],
            "customer_phone": form.get("customer_phone", ""),
            "items": new_items,
            "subtotal": new_subtotal,
            "discount": form.get("discount", 0),
            "discount_code": form.get("discount_code", ""),
            "vat_amount": 0,
            "total": new_total,
            "payment_method": form.get("payment_method", "cash"),
            "notes": form.get("notes", "")
        }
        
        response = requests.put(f"{BASE_URL}/api/registration-forms/{form_id}", 
                               headers=self.headers, json=update_data)
        assert response.status_code == 200, f"Update failed: {response.text}"
        
        updated_form = response.json()
        assert len(updated_form["items"]) == len(new_items)
        assert updated_form["subtotal"] == new_subtotal
        print(f"✅ Form items updated successfully")
        print(f"  - Items count: {len(updated_form['items'])}")
        print(f"  - New subtotal: {updated_form['subtotal']}")
        
        # Restore original items
        update_data["items"] = original_items
        update_data["subtotal"] = form["subtotal"]
        update_data["total"] = form["total"]
        requests.put(f"{BASE_URL}/api/registration-forms/{form_id}", 
                    headers=self.headers, json=update_data)
        print("✅ Restored original items")
    
    def test_cannot_update_converted_form(self):
        """Test that converted forms cannot be updated"""
        # Get all forms and find a converted one
        response = requests.get(f"{BASE_URL}/api/registration-forms", headers=self.headers)
        forms = response.json()
        
        converted_forms = [f for f in forms if f["status"] == "converted"]
        if len(converted_forms) == 0:
            pytest.skip("No converted registration forms available for testing")
        
        form = converted_forms[0]
        form_id = form["id"]
        
        # Try to update the converted form
        update_data = {
            "customer_name": "محاولة تعديل",
            "customer_phone": form.get("customer_phone", ""),
            "items": form["items"],
            "subtotal": form["subtotal"],
            "discount": form.get("discount", 0),
            "discount_code": form.get("discount_code", ""),
            "vat_amount": form.get("vat_amount", 0),
            "total": form["total"],
            "payment_method": form.get("payment_method", "cash"),
            "notes": ""
        }
        
        response = requests.put(f"{BASE_URL}/api/registration-forms/{form_id}", 
                               headers=self.headers, json=update_data)
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        assert "converted" in response.json().get("detail", "").lower()
        print(f"✅ Cannot update converted form - returns 400")
        print(f"  - Error: {response.json().get('detail')}")
    
    def test_update_nonexistent_form_returns_404(self):
        """Test PUT /api/registration-forms/{form_id} returns 404 for non-existent form"""
        update_data = {
            "customer_name": "Test",
            "customer_phone": "0551234567",
            "items": [],
            "subtotal": 0,
            "discount": 0,
            "discount_code": "",
            "vat_amount": 0,
            "total": 0,
            "payment_method": "cash",
            "notes": ""
        }
        
        response = requests.put(f"{BASE_URL}/api/registration-forms/nonexistent-id", 
                               headers=self.headers, json=update_data)
        assert response.status_code == 404
        print("✅ PUT non-existent form returns 404")
    
    def test_form_status_determines_editability(self):
        """Test that form status determines if it can be edited"""
        response = requests.get(f"{BASE_URL}/api/registration-forms", headers=self.headers)
        forms = response.json()
        
        for form in forms:
            status = form["status"]
            form_id = form["id"]
            
            update_data = {
                "customer_name": form["customer_name"],
                "customer_phone": form.get("customer_phone", ""),
                "items": form["items"],
                "subtotal": form["subtotal"],
                "discount": form.get("discount", 0),
                "discount_code": form.get("discount_code", ""),
                "vat_amount": form.get("vat_amount", 0),
                "total": form["total"],
                "payment_method": form.get("payment_method", "cash"),
                "notes": form.get("notes", "")
            }
            
            response = requests.put(f"{BASE_URL}/api/registration-forms/{form_id}", 
                                   headers=self.headers, json=update_data)
            
            if status == "pending":
                assert response.status_code == 200, f"Pending form should be editable"
                print(f"✅ Form {form['form_number']} (pending) - editable")
            elif status == "converted":
                assert response.status_code == 400, f"Converted form should not be editable"
                print(f"✅ Form {form['form_number']} (converted) - not editable")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
