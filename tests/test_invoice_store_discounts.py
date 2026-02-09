"""
Test Suite for Invoice, Store Products, and Discount Coupon Integration
Features tested:
1. Create invoice with activity
2. Add product from store to invoice
3. Apply discount coupon to invoice
4. Verify total calculation with discount and VAT
5. Verify stock deduction when invoice is marked as paid
6. Verify coupon usage count update
"""

import pytest
import requests
import os
import json
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://sports-portal-6.preview.emergentagent.com')
VAT_RATE = 0.15

class TestInvoiceStoreDiscountIntegration:
    """Test invoice creation with products and discount coupons"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data and authentication"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        token = login_response.json().get("access_token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        # Get existing data
        self.activities = self.session.get(f"{BASE_URL}/api/activities").json()
        self.products = self.session.get(f"{BASE_URL}/api/products").json()
        self.discounts = self.session.get(f"{BASE_URL}/api/discounts").json()
        
        yield
        
        # Cleanup - delete test invoices
        invoices = self.session.get(f"{BASE_URL}/api/invoices").json()
        for inv in invoices:
            if inv.get("customer_name_ar", "").startswith("TEST_"):
                try:
                    self.session.delete(f"{BASE_URL}/api/invoices/{inv['id']}")
                except:
                    pass
    
    def test_01_login_and_get_data(self):
        """Test login and verify we have activities, products, and discounts"""
        print(f"Activities count: {len(self.activities)}")
        print(f"Products count: {len(self.products)}")
        print(f"Discounts count: {len(self.discounts)}")
        
        assert len(self.activities) > 0, "No activities found"
        assert len(self.products) > 0, "No products found - need to create test product"
        assert len(self.discounts) > 0, "No discounts found - need to create test discount"
    
    def test_02_create_invoice_with_activity(self):
        """Test creating an invoice with an activity"""
        activity = self.activities[0]
        
        invoice_data = {
            "member_id": None,
            "items": [{
                "activity_id": activity["id"],
                "activity_name": activity["name_ar"],
                "fee": activity["monthly_fee"],
                "period": "2025-01-01 - 2025-02-01",
                "schedule": "السبت والاثنين 4-5 مساءً"
            }],
            "discount": 0,
            "notes": "Test invoice with activity",
            "payment_method": "cash",
            "customer_name_ar": "TEST_عميل اختبار النشاط",
            "customer_phone": "0501234567",
            "customer_address": "الرياض"
        }
        
        response = self.session.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        print(f"Create invoice response: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code in [200, 201], f"Failed to create invoice: {response.text}"
        
        invoice = response.json()
        assert invoice["subtotal"] == activity["monthly_fee"]
        expected_vat = round(activity["monthly_fee"] * VAT_RATE, 2)
        assert invoice["vat_amount"] == expected_vat, f"VAT mismatch: expected {expected_vat}, got {invoice['vat_amount']}"
        expected_total = round(activity["monthly_fee"] + expected_vat, 2)
        assert invoice["total"] == expected_total, f"Total mismatch: expected {expected_total}, got {invoice['total']}"
        
        # Store invoice ID for cleanup
        self.test_invoice_id = invoice["id"]
        print(f"✓ Invoice created with activity: {invoice['id'][:8]}, total: {invoice['total']} SAR")
    
    def test_03_create_invoice_with_product(self):
        """Test creating an invoice with a product from store"""
        if not self.products:
            pytest.skip("No products available")
        
        product = self.products[0]
        initial_stock = product["quantity"]
        
        invoice_data = {
            "member_id": None,
            "items": [{
                "activity_id": product["id"],
                "product_id": product["id"],
                "activity_name": product["name_ar"],
                "fee": product["price"],
                "period": "",
                "schedule": "",
                "is_product": True,
                "quantity": 1
            }],
            "discount": 0,
            "notes": "Test invoice with product",
            "payment_method": "cash",
            "customer_name_ar": "TEST_عميل اختبار المنتج",
            "customer_phone": "0509876543",
            "customer_address": "جدة"
        }
        
        response = self.session.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        print(f"Create product invoice response: {response.status_code}")
        
        assert response.status_code in [200, 201], f"Failed to create invoice with product: {response.text}"
        
        invoice = response.json()
        assert invoice["subtotal"] == product["price"]
        print(f"✓ Invoice created with product: {invoice['id'][:8]}, total: {invoice['total']} SAR")
        
        self.product_invoice_id = invoice["id"]
        self.product_id = product["id"]
        self.initial_stock = initial_stock
    
    def test_04_validate_discount_coupon(self):
        """Test validating a discount coupon"""
        if not self.discounts:
            pytest.skip("No discounts available")
        
        discount = self.discounts[0]
        subtotal = 200.0
        
        response = self.session.post(
            f"{BASE_URL}/api/discounts/validate",
            params={"code": discount["code"], "subtotal": subtotal}
        )
        print(f"Validate discount response: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Failed to validate discount: {response.text}"
        
        result = response.json()
        assert result["valid"] == True
        assert "discount_amount" in result
        
        # Verify discount calculation
        if discount["discount_type"] == "percentage":
            expected_discount = round(subtotal * (discount["value"] / 100), 2)
        else:
            expected_discount = min(discount["value"], subtotal)
        
        assert result["discount_amount"] == expected_discount, f"Discount amount mismatch: expected {expected_discount}, got {result['discount_amount']}"
        print(f"✓ Discount validated: {discount['code']} = {result['discount_amount']} SAR off")
    
    def test_05_create_invoice_with_discount(self):
        """Test creating an invoice with a discount applied"""
        if not self.activities or not self.discounts:
            pytest.skip("No activities or discounts available")
        
        activity = self.activities[0]
        discount = self.discounts[0]
        
        # First validate the discount
        validate_response = self.session.post(
            f"{BASE_URL}/api/discounts/validate",
            params={"code": discount["code"], "subtotal": activity["monthly_fee"]}
        )
        discount_amount = validate_response.json().get("discount_amount", 0)
        
        # Create invoice with discount
        invoice_data = {
            "member_id": None,
            "items": [{
                "activity_id": activity["id"],
                "activity_name": activity["name_ar"],
                "fee": activity["monthly_fee"],
                "period": "2025-01-01 - 2025-02-01",
                "schedule": ""
            }],
            "discount": discount_amount,
            "discount_code": discount["code"],
            "notes": "Test invoice with discount",
            "payment_method": "cash",
            "customer_name_ar": "TEST_عميل اختبار الخصم",
            "customer_phone": "0507654321",
            "customer_address": "الدمام"
        }
        
        response = self.session.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        print(f"Create invoice with discount response: {response.status_code}")
        
        assert response.status_code in [200, 201], f"Failed to create invoice with discount: {response.text}"
        
        invoice = response.json()
        
        # Verify calculations
        subtotal = activity["monthly_fee"]
        after_discount = subtotal - discount_amount
        expected_vat = round(after_discount * VAT_RATE, 2)
        expected_total = round(after_discount + expected_vat, 2)
        
        assert invoice["subtotal"] == subtotal, f"Subtotal mismatch"
        assert invoice["discount"] == discount_amount, f"Discount mismatch"
        assert invoice["vat_amount"] == expected_vat, f"VAT mismatch: expected {expected_vat}, got {invoice['vat_amount']}"
        assert invoice["total"] == expected_total, f"Total mismatch: expected {expected_total}, got {invoice['total']}"
        
        print(f"✓ Invoice with discount created:")
        print(f"  Subtotal: {subtotal} SAR")
        print(f"  Discount: -{discount_amount} SAR")
        print(f"  After discount: {after_discount} SAR")
        print(f"  VAT (15%): {expected_vat} SAR")
        print(f"  Total: {expected_total} SAR")
        
        self.discount_invoice_id = invoice["id"]
        self.discount_code = discount["code"]
    
    def test_06_pay_invoice_and_verify_stock_deduction(self):
        """Test paying an invoice with product and verify stock is deducted"""
        if not self.products:
            pytest.skip("No products available")
        
        product = self.products[0]
        initial_stock = product["quantity"]
        
        # Create invoice with product
        invoice_data = {
            "member_id": None,
            "items": [{
                "activity_id": product["id"],
                "product_id": product["id"],
                "activity_name": product["name_ar"],
                "fee": product["price"],
                "period": "",
                "schedule": "",
                "is_product": True,
                "quantity": 2
            }],
            "discount": 0,
            "notes": "Test stock deduction",
            "payment_method": "cash",
            "customer_name_ar": "TEST_عميل اختبار المخزون",
            "customer_phone": "0501111111",
            "customer_address": ""
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        assert create_response.status_code in [200, 201], f"Failed to create invoice: {create_response.text}"
        
        invoice = create_response.json()
        invoice_id = invoice["id"]
        
        # Pay the invoice
        pay_response = self.session.put(f"{BASE_URL}/api/invoices/{invoice_id}/pay")
        print(f"Pay invoice response: {pay_response.status_code}")
        
        assert pay_response.status_code == 200, f"Failed to pay invoice: {pay_response.text}"
        
        # Verify stock was deducted
        updated_product = self.session.get(f"{BASE_URL}/api/products").json()
        product_after = next((p for p in updated_product if p["id"] == product["id"]), None)
        
        if product_after:
            expected_stock = initial_stock - 2
            print(f"Stock before: {initial_stock}, Stock after: {product_after['quantity']}, Expected: {expected_stock}")
            assert product_after["quantity"] == expected_stock, f"Stock not deducted correctly: expected {expected_stock}, got {product_after['quantity']}"
            print(f"✓ Stock deducted correctly: {initial_stock} -> {product_after['quantity']}")
        else:
            print("⚠ Could not verify stock deduction - product not found")
    
    def test_07_pay_invoice_and_verify_coupon_usage(self):
        """Test paying an invoice with coupon and verify usage count is updated"""
        if not self.activities or not self.discounts:
            pytest.skip("No activities or discounts available")
        
        activity = self.activities[0]
        discount = self.discounts[0]
        initial_usage = discount.get("used_count", 0)
        
        # Validate discount
        validate_response = self.session.post(
            f"{BASE_URL}/api/discounts/validate",
            params={"code": discount["code"], "subtotal": activity["monthly_fee"]}
        )
        discount_amount = validate_response.json().get("discount_amount", 0)
        
        # Create invoice with discount code
        invoice_data = {
            "member_id": None,
            "items": [{
                "activity_id": activity["id"],
                "activity_name": activity["name_ar"],
                "fee": activity["monthly_fee"],
                "period": "2025-01-01 - 2025-02-01",
                "schedule": ""
            }],
            "discount": discount_amount,
            "discount_code": discount["code"],
            "notes": "Test coupon usage",
            "payment_method": "cash",
            "customer_name_ar": "TEST_عميل اختبار استخدام الكوبون",
            "customer_phone": "0502222222",
            "customer_address": ""
        }
        
        create_response = self.session.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        assert create_response.status_code in [200, 201], f"Failed to create invoice: {create_response.text}"
        
        invoice = create_response.json()
        invoice_id = invoice["id"]
        
        # Pay the invoice
        pay_response = self.session.put(f"{BASE_URL}/api/invoices/{invoice_id}/pay")
        print(f"Pay invoice with coupon response: {pay_response.status_code}")
        
        assert pay_response.status_code == 200, f"Failed to pay invoice: {pay_response.text}"
        
        # Verify coupon usage was incremented
        updated_discounts = self.session.get(f"{BASE_URL}/api/discounts").json()
        discount_after = next((d for d in updated_discounts if d["code"] == discount["code"]), None)
        
        if discount_after:
            expected_usage = initial_usage + 1
            print(f"Coupon usage before: {initial_usage}, after: {discount_after['used_count']}, expected: {expected_usage}")
            assert discount_after["used_count"] == expected_usage, f"Coupon usage not updated: expected {expected_usage}, got {discount_after['used_count']}"
            print(f"✓ Coupon usage updated correctly: {initial_usage} -> {discount_after['used_count']}")
        else:
            print("⚠ Could not verify coupon usage - discount not found")
    
    def test_08_create_invoice_with_activity_and_product(self):
        """Test creating an invoice with both activity and product"""
        if not self.activities or not self.products:
            pytest.skip("No activities or products available")
        
        activity = self.activities[0]
        product = self.products[0]
        
        invoice_data = {
            "member_id": None,
            "items": [
                {
                    "activity_id": activity["id"],
                    "activity_name": activity["name_ar"],
                    "fee": activity["monthly_fee"],
                    "period": "2025-01-01 - 2025-02-01",
                    "schedule": "الأحد والثلاثاء 5-6 مساءً"
                },
                {
                    "activity_id": product["id"],
                    "product_id": product["id"],
                    "activity_name": product["name_ar"],
                    "fee": product["price"],
                    "period": "",
                    "schedule": "",
                    "is_product": True,
                    "quantity": 1
                }
            ],
            "discount": 0,
            "notes": "Test invoice with activity and product",
            "payment_method": "card",
            "customer_name_ar": "TEST_عميل اختبار مختلط",
            "customer_phone": "0503333333",
            "customer_address": "مكة"
        }
        
        response = self.session.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        print(f"Create mixed invoice response: {response.status_code}")
        
        assert response.status_code in [200, 201], f"Failed to create mixed invoice: {response.text}"
        
        invoice = response.json()
        expected_subtotal = activity["monthly_fee"] + product["price"]
        expected_vat = round(expected_subtotal * VAT_RATE, 2)
        expected_total = round(expected_subtotal + expected_vat, 2)
        
        assert invoice["subtotal"] == expected_subtotal, f"Subtotal mismatch: expected {expected_subtotal}, got {invoice['subtotal']}"
        assert invoice["total"] == expected_total, f"Total mismatch: expected {expected_total}, got {invoice['total']}"
        
        print(f"✓ Mixed invoice created:")
        print(f"  Activity: {activity['name_ar']} = {activity['monthly_fee']} SAR")
        print(f"  Product: {product['name_ar']} = {product['price']} SAR")
        print(f"  Subtotal: {expected_subtotal} SAR")
        print(f"  VAT (15%): {expected_vat} SAR")
        print(f"  Total: {expected_total} SAR")
    
    def test_09_invalid_coupon_code(self):
        """Test that invalid coupon code returns error"""
        response = self.session.post(
            f"{BASE_URL}/api/discounts/validate",
            params={"code": "INVALID_CODE_12345", "subtotal": 200.0}
        )
        print(f"Invalid coupon response: {response.status_code}")
        
        assert response.status_code == 404, f"Expected 404 for invalid coupon, got {response.status_code}"
        print("✓ Invalid coupon correctly rejected")
    
    def test_10_insufficient_stock(self):
        """Test that invoice with insufficient stock fails on payment"""
        if not self.products:
            pytest.skip("No products available")
        
        product = self.products[0]
        
        # Try to create invoice with more quantity than available
        invoice_data = {
            "member_id": None,
            "items": [{
                "activity_id": product["id"],
                "product_id": product["id"],
                "activity_name": product["name_ar"],
                "fee": product["price"] * 1000,  # 1000 items
                "period": "",
                "schedule": "",
                "is_product": True,
                "quantity": 1000  # More than available
            }],
            "discount": 0,
            "notes": "Test insufficient stock",
            "payment_method": "cash",
            "customer_name_ar": "TEST_عميل اختبار المخزون الناقص",
            "customer_phone": "0504444444",
            "customer_address": ""
        }
        
        # Create invoice (should succeed)
        create_response = self.session.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        
        if create_response.status_code in [200, 201]:
            invoice = create_response.json()
            # Try to pay (should fail due to insufficient stock)
            pay_response = self.session.put(f"{BASE_URL}/api/invoices/{invoice['id']}/pay")
            print(f"Pay with insufficient stock response: {pay_response.status_code}")
            
            # Should fail with 400
            assert pay_response.status_code == 400, f"Expected 400 for insufficient stock, got {pay_response.status_code}"
            print("✓ Insufficient stock correctly rejected on payment")
        else:
            print(f"Invoice creation failed (may be expected): {create_response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
