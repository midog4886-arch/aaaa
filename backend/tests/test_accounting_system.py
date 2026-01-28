"""
Accounting System Tests - نظام المحاسبة
Tests for: Chart of Accounts, Suppliers, Purchase Invoices, Journal Entries, Supplier Payments
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAccountingSystem:
    """Comprehensive tests for the accounting system"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - login and get token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        self.token = data["access_token"]
        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
        
    # ============ CHART OF ACCOUNTS TESTS ============
    
    def test_get_accounts(self):
        """Test GET /api/accounts - Get chart of accounts"""
        response = self.session.get(f"{BASE_URL}/api/accounts")
        assert response.status_code == 200, f"Failed to get accounts: {response.text}"
        accounts = response.json()
        assert isinstance(accounts, list), "Response should be a list"
        print(f"✅ GET /api/accounts - Found {len(accounts)} accounts")
        return accounts
    
    def test_accounts_structure(self):
        """Test that accounts have correct structure"""
        response = self.session.get(f"{BASE_URL}/api/accounts")
        assert response.status_code == 200
        accounts = response.json()
        
        if len(accounts) > 0:
            account = accounts[0]
            required_fields = ["id", "code", "name_ar", "account_type"]
            for field in required_fields:
                assert field in account, f"Account missing field: {field}"
            print(f"✅ Accounts have correct structure with fields: {list(account.keys())}")
    
    def test_seed_default_accounts_already_exists(self):
        """Test POST /api/accounts/seed-default - Should fail if accounts exist"""
        response = self.session.post(f"{BASE_URL}/api/accounts/seed-default")
        # Should return 400 if accounts already exist
        if response.status_code == 400:
            assert "موجودة مسبقاً" in response.json().get("detail", "")
            print("✅ POST /api/accounts/seed-default - Correctly returns 400 when accounts exist")
        else:
            print(f"⚠️ POST /api/accounts/seed-default - Status: {response.status_code}")
    
    def test_create_account(self):
        """Test POST /api/accounts - Create new account"""
        test_account = {
            "code": "9999",
            "name_ar": "حساب اختباري",
            "name": "Test Account",
            "account_type": "expenses",
            "is_parent": False,
            "description": "حساب للاختبار"
        }
        response = self.session.post(f"{BASE_URL}/api/accounts", json=test_account)
        
        if response.status_code == 200:
            account = response.json()
            assert account["code"] == "9999"
            assert account["name_ar"] == "حساب اختباري"
            print(f"✅ POST /api/accounts - Created account: {account['code']} - {account['name_ar']}")
            
            # Cleanup - delete the test account
            delete_response = self.session.delete(f"{BASE_URL}/api/accounts/{account['id']}")
            print(f"   Cleanup: Deleted test account - Status: {delete_response.status_code}")
        elif response.status_code == 400:
            # Account code already exists
            print(f"⚠️ POST /api/accounts - Account code 9999 already exists")
        else:
            pytest.fail(f"Unexpected status: {response.status_code} - {response.text}")
    
    # ============ SUPPLIERS TESTS ============
    
    def test_get_suppliers(self):
        """Test GET /api/suppliers - Get all suppliers"""
        response = self.session.get(f"{BASE_URL}/api/suppliers")
        assert response.status_code == 200, f"Failed to get suppliers: {response.text}"
        suppliers = response.json()
        assert isinstance(suppliers, list), "Response should be a list"
        print(f"✅ GET /api/suppliers - Found {len(suppliers)} suppliers")
        return suppliers
    
    def test_create_supplier(self):
        """Test POST /api/suppliers - Create new supplier"""
        test_supplier = {
            "name_ar": "مورد اختباري TEST",
            "name": "Test Supplier",
            "phone": "0500000000",
            "email": "test@supplier.com",
            "address": "عنوان اختباري",
            "tax_number": "123456789",
            "commercial_reg": "987654321",
            "contact_person": "محمد",
            "payment_terms": 30
        }
        response = self.session.post(f"{BASE_URL}/api/suppliers", json=test_supplier)
        assert response.status_code == 200, f"Failed to create supplier: {response.text}"
        
        supplier = response.json()
        assert supplier["name_ar"] == "مورد اختباري TEST"
        assert supplier["phone"] == "0500000000"
        assert supplier["balance"] == 0, "New supplier should have 0 balance"
        print(f"✅ POST /api/suppliers - Created supplier: {supplier['name_ar']} (ID: {supplier['id']})")
        
        # Store for later tests
        self.test_supplier_id = supplier["id"]
        return supplier
    
    def test_get_supplier_by_id(self):
        """Test GET /api/suppliers/{id} - Get single supplier"""
        # First create a supplier
        supplier = self.test_create_supplier()
        
        response = self.session.get(f"{BASE_URL}/api/suppliers/{supplier['id']}")
        assert response.status_code == 200, f"Failed to get supplier: {response.text}"
        
        fetched = response.json()
        assert fetched["id"] == supplier["id"]
        assert fetched["name_ar"] == supplier["name_ar"]
        print(f"✅ GET /api/suppliers/{supplier['id']} - Retrieved supplier successfully")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/suppliers/{supplier['id']}")
    
    def test_update_supplier(self):
        """Test PUT /api/suppliers/{id} - Update supplier"""
        # First create a supplier
        supplier = self.test_create_supplier()
        
        update_data = {
            "name_ar": "مورد محدث TEST",
            "name": "Updated Supplier",
            "phone": "0511111111",
            "email": "updated@supplier.com",
            "address": "عنوان محدث",
            "payment_terms": 45
        }
        response = self.session.put(f"{BASE_URL}/api/suppliers/{supplier['id']}", json=update_data)
        assert response.status_code == 200, f"Failed to update supplier: {response.text}"
        
        updated = response.json()
        assert updated["name_ar"] == "مورد محدث TEST"
        assert updated["phone"] == "0511111111"
        print(f"✅ PUT /api/suppliers/{supplier['id']} - Updated supplier successfully")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/suppliers/{supplier['id']}")
    
    def test_delete_supplier_without_invoices(self):
        """Test DELETE /api/suppliers/{id} - Delete supplier without invoices"""
        # First create a supplier
        supplier = self.test_create_supplier()
        
        response = self.session.delete(f"{BASE_URL}/api/suppliers/{supplier['id']}")
        assert response.status_code == 200, f"Failed to delete supplier: {response.text}"
        
        # Verify deletion
        get_response = self.session.get(f"{BASE_URL}/api/suppliers/{supplier['id']}")
        assert get_response.status_code == 404, "Supplier should not exist after deletion"
        print(f"✅ DELETE /api/suppliers/{supplier['id']} - Deleted supplier successfully")
    
    # ============ PURCHASE INVOICES TESTS ============
    
    def test_get_purchase_invoices(self):
        """Test GET /api/purchase-invoices - Get all purchase invoices"""
        response = self.session.get(f"{BASE_URL}/api/purchase-invoices")
        assert response.status_code == 200, f"Failed to get purchase invoices: {response.text}"
        invoices = response.json()
        assert isinstance(invoices, list), "Response should be a list"
        print(f"✅ GET /api/purchase-invoices - Found {len(invoices)} invoices")
        return invoices
    
    def test_create_purchase_invoice_with_journal_entry(self):
        """Test POST /api/purchase-invoices - Create invoice and verify journal entry"""
        # First create a supplier
        supplier = self.test_create_supplier()
        
        # Create purchase invoice
        today = datetime.now().strftime("%Y-%m-%d")
        invoice_data = {
            "supplier_id": supplier["id"],
            "supplier_invoice_number": "SUP-INV-001",
            "invoice_date": today,
            "due_date": today,
            "items": [
                {
                    "description": "معدات سباحة اختبارية",
                    "quantity": 10,
                    "unit_price": 100,
                    "tax_rate": 15
                }
            ],
            "payment_method": "credit",
            "notes": "فاتورة اختبارية"
        }
        
        response = self.session.post(f"{BASE_URL}/api/purchase-invoices", json=invoice_data)
        assert response.status_code == 200, f"Failed to create purchase invoice: {response.text}"
        
        invoice = response.json()
        
        # Verify invoice data
        assert invoice["supplier_id"] == supplier["id"]
        assert invoice["subtotal"] == 1000  # 10 * 100
        assert invoice["tax_amount"] == 150  # 1000 * 15%
        assert invoice["total"] == 1150  # 1000 + 150
        assert invoice["status"] == "pending"
        assert invoice.get("journal_entry_id") is not None, "Journal entry should be created"
        
        print(f"✅ POST /api/purchase-invoices - Created invoice: {invoice['invoice_number']}")
        print(f"   Subtotal: {invoice['subtotal']}, Tax: {invoice['tax_amount']}, Total: {invoice['total']}")
        print(f"   Journal Entry ID: {invoice['journal_entry_id']}")
        
        # Verify journal entry was created
        je_response = self.session.get(f"{BASE_URL}/api/journal-entries/{invoice['journal_entry_id']}")
        if je_response.status_code == 200:
            je = je_response.json()
            assert je["total_debit"] == je["total_credit"], "Journal entry should be balanced"
            assert je["is_balanced"] == True
            print(f"   ✅ Journal Entry {je['entry_number']} is balanced: Debit={je['total_debit']}, Credit={je['total_credit']}")
        
        # Verify supplier balance was updated
        supplier_response = self.session.get(f"{BASE_URL}/api/suppliers/{supplier['id']}")
        if supplier_response.status_code == 200:
            updated_supplier = supplier_response.json()
            assert updated_supplier["balance"] == 1150, f"Supplier balance should be 1150, got {updated_supplier['balance']}"
            print(f"   ✅ Supplier balance updated: {updated_supplier['balance']}")
        
        # Cleanup - delete invoice first, then supplier
        self.session.delete(f"{BASE_URL}/api/purchase-invoices/{invoice['id']}")
        self.session.delete(f"{BASE_URL}/api/suppliers/{supplier['id']}")
        
        return invoice
    
    def test_purchase_invoice_balance_verification(self):
        """Test that purchase invoice journal entry is balanced (Debit = Credit)"""
        # Create supplier
        supplier = self.test_create_supplier()
        
        # Create invoice with multiple items
        today = datetime.now().strftime("%Y-%m-%d")
        invoice_data = {
            "supplier_id": supplier["id"],
            "invoice_date": today,
            "items": [
                {"description": "بند 1", "quantity": 5, "unit_price": 200, "tax_rate": 15},
                {"description": "بند 2", "quantity": 3, "unit_price": 150, "tax_rate": 15}
            ],
            "payment_method": "credit"
        }
        
        response = self.session.post(f"{BASE_URL}/api/purchase-invoices", json=invoice_data)
        assert response.status_code == 200
        invoice = response.json()
        
        # Expected: (5*200 + 3*150) = 1450 subtotal, 217.5 tax, 1667.5 total
        expected_subtotal = 5*200 + 3*150  # 1450
        expected_tax = expected_subtotal * 0.15  # 217.5
        expected_total = expected_subtotal + expected_tax  # 1667.5
        
        assert invoice["subtotal"] == expected_subtotal
        assert invoice["tax_amount"] == expected_tax
        assert invoice["total"] == expected_total
        
        # Verify journal entry balance
        if invoice.get("journal_entry_id"):
            je_response = self.session.get(f"{BASE_URL}/api/journal-entries/{invoice['journal_entry_id']}")
            if je_response.status_code == 200:
                je = je_response.json()
                assert je["total_debit"] == je["total_credit"], f"Debit ({je['total_debit']}) != Credit ({je['total_credit']})"
                assert je["total_debit"] == expected_total
                print(f"✅ Journal entry balance verified: Debit = Credit = {je['total_debit']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/purchase-invoices/{invoice['id']}")
        self.session.delete(f"{BASE_URL}/api/suppliers/{supplier['id']}")
    
    # ============ SUPPLIER PAYMENTS TESTS ============
    
    def test_create_supplier_payment(self):
        """Test POST /api/supplier-payments - Create payment and verify balance update"""
        # Create supplier
        supplier = self.test_create_supplier()
        
        # Create purchase invoice
        today = datetime.now().strftime("%Y-%m-%d")
        invoice_data = {
            "supplier_id": supplier["id"],
            "invoice_date": today,
            "items": [{"description": "بند", "quantity": 1, "unit_price": 1000, "tax_rate": 15}],
            "payment_method": "credit"
        }
        inv_response = self.session.post(f"{BASE_URL}/api/purchase-invoices", json=invoice_data)
        assert inv_response.status_code == 200
        invoice = inv_response.json()
        
        # Verify initial supplier balance
        supplier_before = self.session.get(f"{BASE_URL}/api/suppliers/{supplier['id']}").json()
        initial_balance = supplier_before["balance"]
        print(f"   Initial supplier balance: {initial_balance}")
        
        # Create partial payment
        payment_amount = 500
        payment_data = {
            "supplier_id": supplier["id"],
            "purchase_invoice_id": invoice["id"],
            "amount": payment_amount,
            "payment_date": today,
            "payment_method": "cash",
            "reference": "PAY-001",
            "notes": "سداد جزئي"
        }
        
        pay_response = self.session.post(f"{BASE_URL}/api/supplier-payments", json=payment_data)
        assert pay_response.status_code == 200, f"Failed to create payment: {pay_response.text}"
        payment = pay_response.json()
        
        print(f"✅ POST /api/supplier-payments - Created payment: {payment_amount}")
        
        # Verify supplier balance was reduced
        supplier_after = self.session.get(f"{BASE_URL}/api/suppliers/{supplier['id']}").json()
        expected_balance = initial_balance - payment_amount
        assert supplier_after["balance"] == expected_balance, f"Expected balance {expected_balance}, got {supplier_after['balance']}"
        print(f"   ✅ Supplier balance updated: {initial_balance} -> {supplier_after['balance']}")
        
        # Verify invoice status changed to partial
        inv_after = self.session.get(f"{BASE_URL}/api/purchase-invoices/{invoice['id']}").json()
        assert inv_after["status"] == "partial", f"Expected status 'partial', got {inv_after['status']}"
        assert inv_after["paid_amount"] == payment_amount
        print(f"   ✅ Invoice status: {inv_after['status']}, Paid: {inv_after['paid_amount']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/purchase-invoices/{invoice['id']}")
        self.session.delete(f"{BASE_URL}/api/suppliers/{supplier['id']}")
    
    def test_full_payment_marks_invoice_paid(self):
        """Test that full payment marks invoice as paid"""
        # Create supplier
        supplier = self.test_create_supplier()
        
        # Create purchase invoice
        today = datetime.now().strftime("%Y-%m-%d")
        invoice_data = {
            "supplier_id": supplier["id"],
            "invoice_date": today,
            "items": [{"description": "بند", "quantity": 1, "unit_price": 1000, "tax_rate": 15}],
            "payment_method": "credit"
        }
        inv_response = self.session.post(f"{BASE_URL}/api/purchase-invoices", json=invoice_data)
        invoice = inv_response.json()
        
        # Create full payment
        payment_data = {
            "supplier_id": supplier["id"],
            "purchase_invoice_id": invoice["id"],
            "amount": invoice["total"],  # Full amount
            "payment_date": today,
            "payment_method": "bank_transfer"
        }
        
        pay_response = self.session.post(f"{BASE_URL}/api/supplier-payments", json=payment_data)
        assert pay_response.status_code == 200
        
        # Verify invoice is marked as paid
        inv_after = self.session.get(f"{BASE_URL}/api/purchase-invoices/{invoice['id']}").json()
        assert inv_after["status"] == "paid", f"Expected status 'paid', got {inv_after['status']}"
        assert inv_after["remaining_amount"] == 0
        print(f"✅ Full payment marks invoice as paid: Status={inv_after['status']}, Remaining={inv_after['remaining_amount']}")
        
        # Verify supplier balance is 0
        supplier_after = self.session.get(f"{BASE_URL}/api/suppliers/{supplier['id']}").json()
        assert supplier_after["balance"] == 0, f"Expected balance 0, got {supplier_after['balance']}"
        print(f"   ✅ Supplier balance is 0 after full payment")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/purchase-invoices/{invoice['id']}")
        self.session.delete(f"{BASE_URL}/api/suppliers/{supplier['id']}")
    
    # ============ JOURNAL ENTRIES TESTS ============
    
    def test_get_journal_entries(self):
        """Test GET /api/journal-entries - Get all journal entries"""
        response = self.session.get(f"{BASE_URL}/api/journal-entries")
        assert response.status_code == 200, f"Failed to get journal entries: {response.text}"
        entries = response.json()
        assert isinstance(entries, list), "Response should be a list"
        print(f"✅ GET /api/journal-entries - Found {len(entries)} entries")
        return entries
    
    def test_journal_entries_are_balanced(self):
        """Test that all journal entries are balanced (Debit = Credit)"""
        response = self.session.get(f"{BASE_URL}/api/journal-entries")
        assert response.status_code == 200
        entries = response.json()
        
        unbalanced = []
        for entry in entries:
            if entry["total_debit"] != entry["total_credit"]:
                unbalanced.append({
                    "entry_number": entry["entry_number"],
                    "debit": entry["total_debit"],
                    "credit": entry["total_credit"]
                })
        
        if unbalanced:
            print(f"⚠️ Found {len(unbalanced)} unbalanced entries:")
            for ub in unbalanced:
                print(f"   {ub['entry_number']}: Debit={ub['debit']}, Credit={ub['credit']}")
            pytest.fail(f"Found {len(unbalanced)} unbalanced journal entries")
        else:
            print(f"✅ All {len(entries)} journal entries are balanced (Debit = Credit)")
    
    def test_create_manual_journal_entry(self):
        """Test POST /api/journal-entries - Create manual journal entry"""
        # Get accounts for the entry
        accounts_response = self.session.get(f"{BASE_URL}/api/accounts")
        accounts = accounts_response.json()
        
        if len(accounts) < 2:
            pytest.skip("Not enough accounts to create journal entry")
        
        # Find cash and expense accounts
        cash_account = next((a for a in accounts if a["code"] == "1110"), accounts[0])
        expense_account = next((a for a in accounts if a["code"] == "5800"), accounts[1])
        
        today = datetime.now().strftime("%Y-%m-%d")
        entry_data = {
            "entry_date": today,
            "journal_type": "general",
            "reference_type": "manual",
            "reference_number": "TEST-001",
            "lines": [
                {
                    "account_id": expense_account["id"],
                    "account_code": expense_account["code"],
                    "account_name": expense_account["name_ar"],
                    "debit": 500,
                    "credit": 0,
                    "description": "مصروف اختباري"
                },
                {
                    "account_id": cash_account["id"],
                    "account_code": cash_account["code"],
                    "account_name": cash_account["name_ar"],
                    "debit": 0,
                    "credit": 500,
                    "description": "دفع نقدي"
                }
            ],
            "notes": "قيد اختباري يدوي"
        }
        
        response = self.session.post(f"{BASE_URL}/api/journal-entries", json=entry_data)
        assert response.status_code == 200, f"Failed to create journal entry: {response.text}"
        
        entry = response.json()
        assert entry["total_debit"] == 500
        assert entry["total_credit"] == 500
        assert entry["is_balanced"] == True
        print(f"✅ POST /api/journal-entries - Created entry: {entry['entry_number']}")
        print(f"   Debit: {entry['total_debit']}, Credit: {entry['total_credit']}, Balanced: {entry['is_balanced']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/journal-entries/{entry['id']}")
    
    def test_unbalanced_journal_entry_rejected(self):
        """Test that unbalanced journal entries are rejected"""
        accounts_response = self.session.get(f"{BASE_URL}/api/accounts")
        accounts = accounts_response.json()
        
        if len(accounts) < 2:
            pytest.skip("Not enough accounts")
        
        today = datetime.now().strftime("%Y-%m-%d")
        entry_data = {
            "entry_date": today,
            "journal_type": "general",
            "lines": [
                {
                    "account_id": accounts[0]["id"],
                    "account_code": accounts[0]["code"],
                    "account_name": accounts[0]["name_ar"],
                    "debit": 1000,
                    "credit": 0,
                    "description": "مدين"
                },
                {
                    "account_id": accounts[1]["id"],
                    "account_code": accounts[1]["code"],
                    "account_name": accounts[1]["name_ar"],
                    "debit": 0,
                    "credit": 500,  # Intentionally unbalanced
                    "description": "دائن"
                }
            ]
        }
        
        response = self.session.post(f"{BASE_URL}/api/journal-entries", json=entry_data)
        assert response.status_code == 400, f"Expected 400 for unbalanced entry, got {response.status_code}"
        assert "غير متوازن" in response.json().get("detail", "")
        print(f"✅ Unbalanced journal entry correctly rejected with 400")
    
    # ============ INTEGRATION TESTS ============
    
    def test_full_purchase_workflow(self):
        """Test complete purchase workflow: Supplier -> Invoice -> Payment -> Balance"""
        print("\n=== Full Purchase Workflow Test ===")
        
        # 1. Create supplier
        supplier_data = {
            "name_ar": "مورد سير العمل TEST",
            "phone": "0599999999",
            "payment_terms": 30
        }
        supplier_response = self.session.post(f"{BASE_URL}/api/suppliers", json=supplier_data)
        assert supplier_response.status_code == 200
        supplier = supplier_response.json()
        print(f"1. Created supplier: {supplier['name_ar']}")
        
        # 2. Create purchase invoice
        today = datetime.now().strftime("%Y-%m-%d")
        invoice_data = {
            "supplier_id": supplier["id"],
            "invoice_date": today,
            "items": [
                {"description": "منتج 1", "quantity": 2, "unit_price": 500, "tax_rate": 15},
                {"description": "منتج 2", "quantity": 1, "unit_price": 300, "tax_rate": 15}
            ],
            "payment_method": "credit"
        }
        inv_response = self.session.post(f"{BASE_URL}/api/purchase-invoices", json=invoice_data)
        assert inv_response.status_code == 200
        invoice = inv_response.json()
        print(f"2. Created invoice: {invoice['invoice_number']}, Total: {invoice['total']}")
        
        # 3. Verify journal entry created
        assert invoice.get("journal_entry_id") is not None
        je_response = self.session.get(f"{BASE_URL}/api/journal-entries/{invoice['journal_entry_id']}")
        je = je_response.json()
        assert je["total_debit"] == je["total_credit"]
        print(f"3. Journal entry created: {je['entry_number']}, Balanced: {je['is_balanced']}")
        
        # 4. Verify supplier balance
        supplier_check = self.session.get(f"{BASE_URL}/api/suppliers/{supplier['id']}").json()
        assert supplier_check["balance"] == invoice["total"]
        print(f"4. Supplier balance: {supplier_check['balance']}")
        
        # 5. Make partial payment
        payment_data = {
            "supplier_id": supplier["id"],
            "purchase_invoice_id": invoice["id"],
            "amount": 500,
            "payment_date": today,
            "payment_method": "cash"
        }
        pay_response = self.session.post(f"{BASE_URL}/api/supplier-payments", json=payment_data)
        assert pay_response.status_code == 200
        print(f"5. Made payment: 500")
        
        # 6. Verify updated balances
        supplier_after = self.session.get(f"{BASE_URL}/api/suppliers/{supplier['id']}").json()
        invoice_after = self.session.get(f"{BASE_URL}/api/purchase-invoices/{invoice['id']}").json()
        
        expected_balance = invoice["total"] - 500
        assert supplier_after["balance"] == expected_balance
        assert invoice_after["status"] == "partial"
        assert invoice_after["paid_amount"] == 500
        print(f"6. After payment - Supplier balance: {supplier_after['balance']}, Invoice status: {invoice_after['status']}")
        
        # 7. Make final payment
        remaining = invoice_after["remaining_amount"]
        final_payment = {
            "supplier_id": supplier["id"],
            "purchase_invoice_id": invoice["id"],
            "amount": remaining,
            "payment_date": today,
            "payment_method": "bank_transfer"
        }
        self.session.post(f"{BASE_URL}/api/supplier-payments", json=final_payment)
        
        # 8. Verify final state
        supplier_final = self.session.get(f"{BASE_URL}/api/suppliers/{supplier['id']}").json()
        invoice_final = self.session.get(f"{BASE_URL}/api/purchase-invoices/{invoice['id']}").json()
        
        assert supplier_final["balance"] == 0
        assert invoice_final["status"] == "paid"
        print(f"7. Final state - Supplier balance: {supplier_final['balance']}, Invoice status: {invoice_final['status']}")
        
        print("✅ Full purchase workflow completed successfully!")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/purchase-invoices/{invoice['id']}")
        self.session.delete(f"{BASE_URL}/api/suppliers/{supplier['id']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
