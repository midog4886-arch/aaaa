#!/usr/bin/env python3
"""
Backend API Testing for Sports Academy Management System
Tests all API endpoints with Arabic RTL support
"""

import requests
import sys
import json
from datetime import datetime, timedelta

class AcademyAPITester:
    def __init__(self, base_url="https://champions-portal-2.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        
        if headers:
            test_headers.update(headers)

        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=test_headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers, timeout=10)

            success = response.status_code == expected_status
            details = f"Status: {response.status_code}"
            
            if not success:
                details += f", Expected: {expected_status}"
                try:
                    error_data = response.json()
                    details += f", Error: {error_data.get('detail', 'Unknown error')}"
                except:
                    details += f", Response: {response.text[:100]}"

            self.log_test(name, success, details)
            
            if success:
                try:
                    return response.json()
                except:
                    return {"status": "success"}
            return None

        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}")
            return None

    def test_seed_data(self):
        """Test seeding demo data"""
        print("\n🌱 Testing Seed Data...")
        result = self.run_test("Seed Demo Data", "POST", "seed", 200)
        return result is not None

    def test_login(self):
        """Test admin login"""
        print("\n🔐 Testing Authentication...")
        login_data = {
            "username": "admin",
            "password": "admin123"
        }
        
        result = self.run_test("Admin Login", "POST", "auth/login", 200, login_data)
        
        if result and 'access_token' in result:
            self.token = result['access_token']
            self.log_test("Token Retrieved", True, "Authentication successful")
            return True
        else:
            self.log_test("Token Retrieved", False, "No access token in response")
            return False

    def test_dashboard_stats(self):
        """Test dashboard statistics"""
        print("\n📊 Testing Dashboard...")
        result = self.run_test("Dashboard Stats", "GET", "dashboard/stats", 200)
        
        if result:
            required_fields = ['members_count', 'activities_count', 'coaches_count', 'active_subscriptions']
            for field in required_fields:
                if field in result:
                    self.log_test(f"Dashboard {field}", True, f"Value: {result[field]}")
                else:
                    self.log_test(f"Dashboard {field}", False, "Field missing")
        
        return result is not None

    def test_activities(self):
        """Test activities CRUD operations"""
        print("\n🏃 Testing Activities...")
        
        # Get activities
        activities = self.run_test("Get Activities", "GET", "activities", 200)
        
        if activities:
            self.log_test("Activities List", True, f"Found {len(activities)} activities")
            
            # Check for required sports
            required_sports = ['السباحة', 'كرة القدم', 'الكاراتيه', 'الجمباز']
            found_sports = [act.get('name_ar', '') for act in activities]
            
            for sport in required_sports:
                if sport in found_sports:
                    self.log_test(f"Activity {sport}", True, "Found in activities")
                else:
                    self.log_test(f"Activity {sport}", False, "Missing from activities")
        
        return activities

    def test_coaches(self):
        """Test coaches operations"""
        print("\n👨‍🏫 Testing Coaches...")
        
        coaches = self.run_test("Get Coaches", "GET", "coaches", 200)
        
        if coaches:
            self.log_test("Coaches List", True, f"Found {len(coaches)} coaches")
        
        return coaches

    def test_members(self):
        """Test members operations"""
        print("\n👥 Testing Members...")
        
        members = self.run_test("Get Members", "GET", "members", 200)
        
        if members is not None:
            self.log_test("Members List", True, f"Found {len(members)} members")
        
        return members

    def test_invoices(self):
        """Test invoices operations"""
        print("\n🧾 Testing Invoices...")
        
        invoices = self.run_test("Get Invoices", "GET", "invoices", 200)
        
        if invoices is not None:
            self.log_test("Invoices List", True, f"Found {len(invoices)} invoices")
        
        return invoices

    def test_reports(self):
        """Test reports functionality"""
        print("\n📈 Testing Reports...")
        
        # Financial report
        financial = self.run_test("Financial Report", "GET", "reports/financial", 200)
        
        if financial:
            required_fields = ['total_revenue', 'invoice_count', 'revenue_by_activity']
            for field in required_fields:
                if field in financial:
                    self.log_test(f"Report {field}", True, f"Present")
                else:
                    self.log_test(f"Report {field}", False, "Missing")
        
        # Expiring subscriptions
        expiring = self.run_test("Expiring Subscriptions", "GET", "reports/expiring-subscriptions", 200)
        
        return financial and expiring

    def test_member_creation(self):
        """Test creating a new member with activities"""
        print("\n➕ Testing Member Creation...")
        
        # First get activities to use in member creation
        activities = self.run_test("Get Activities for Member", "GET", "activities", 200)
        
        if not activities or len(activities) == 0:
            self.log_test("Member Creation", False, "No activities available")
            return False
        
        # Create test member
        member_data = {
            "name": "Test Member",
            "name_ar": "عضو تجريبي",
            "age": 15,
            "guardian_name": "Test Guardian",
            "guardian_name_ar": "ولي أمر تجريبي",
            "phone": "0501234567",
            "email": "test@example.com",
            "notes": "Test member for API testing",
            "activities": [
                {
                    "activity_id": activities[0]["id"],
                    "activity_name": activities[0]["name_ar"],
                    "start_date": datetime.now().strftime("%Y-%m-%d"),
                    "end_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
                    "fee": activities[0]["monthly_fee"],
                    "status": "active"
                }
            ]
        }
        
        result = self.run_test("Create Member", "POST", "members", 201, member_data)
        
        if result and 'id' in result:
            member_id = result['id']
            self.log_test("Member Created", True, f"ID: {member_id}")
            
            # Test getting the created member
            member = self.run_test("Get Created Member", "GET", f"members/{member_id}", 200)
            
            if member:
                self.log_test("Member Retrieved", True, f"Name: {member.get('name_ar', 'N/A')}")
            
            return member_id
        
        return None

    def test_invoice_creation(self, member_id=None):
        """Test creating an invoice with customer data and VAT calculation"""
        print("\n💰 Testing Invoice Creation with VAT...")
        
        # Get activities
        activities = self.run_test("Get Activities for Invoice", "GET", "activities", 200)
        if not activities or len(activities) == 0:
            self.log_test("Invoice Creation", False, "No activities available")
            return False
        
        # Test 1: Invoice with member
        if member_id:
            invoice_data = {
                "member_id": member_id,
                "items": [
                    {
                        "activity_id": activities[0]["id"],
                        "activity_name": activities[0]["name_ar"],
                        "fee": 300.0,  # Test with 300 SAR
                        "period": f"{datetime.now().strftime('%Y-%m-%d')} - {(datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')}"
                    }
                ],
                "discount": 0,
                "notes": "Test invoice with VAT",
                "payment_method": "cash",
                "customer_name_ar": "عميل تجريبي",
                "customer_phone": "0501234567",
                "customer_address": "Test Address"
            }
            
            result = self.run_test("Create Invoice with Member", "POST", "invoices", 201, invoice_data)
            
            if result and 'id' in result:
                invoice_id = result['id']
                self.log_test("Invoice Created", True, f"ID: {invoice_id}")
                
                # Test VAT calculation (300 * 0.15 = 45, total = 345)
                expected_vat = 45.0
                expected_total = 345.0
                
                if abs(result.get('vat_amount', 0) - expected_vat) < 0.01:
                    self.log_test("VAT 15% Calculation", True, f"VAT: {result.get('vat_amount')} SAR")
                else:
                    self.log_test("VAT 15% Calculation", False, f"Expected {expected_vat}, got {result.get('vat_amount')}")
                
                if abs(result.get('total', 0) - expected_total) < 0.01:
                    self.log_test("Total with VAT", True, f"Total: {result.get('total')} SAR")
                else:
                    self.log_test("Total with VAT", False, f"Expected {expected_total}, got {result.get('total')}")
                
                # Test company info
                if result.get('tax_number') == "312655637900003":
                    self.log_test("Tax Number", True, "Correct tax number stored")
                else:
                    self.log_test("Tax Number", False, f"Expected 312655637900003, got {result.get('tax_number')}")
                
                if result.get('commercial_reg') == "7043630230":
                    self.log_test("Commercial Registration", True, "Correct commercial reg stored")
                else:
                    self.log_test("Commercial Registration", False, f"Expected 7043630230, got {result.get('commercial_reg')}")
                
                return invoice_id
        
        # Test 2: Invoice without member (new feature)
        invoice_data_no_member = {
            "member_id": None,
            "items": [
                {
                    "activity_id": activities[0]["id"],
                    "activity_name": activities[0]["name_ar"],
                    "fee": 250.0,
                    "period": f"{datetime.now().strftime('%Y-%m-%d')} - {(datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')}"
                },
                {
                    "activity_id": activities[1]["id"] if len(activities) > 1 else activities[0]["id"],
                    "activity_name": activities[1]["name_ar"] if len(activities) > 1 else activities[0]["name_ar"],
                    "fee": 350.0,
                    "period": f"{datetime.now().strftime('%Y-%m-%d')} - {(datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')}"
                }
            ],
            "discount": 50.0,  # Test with discount
            "notes": "Test invoice without member, multiple activities",
            "payment_method": "cash",
            "customer_name_ar": "عميل بدون عضوية",
            "customer_phone": "0509876543",
            "customer_address": "عنوان تجريبي"
        }
        
        result2 = self.run_test("Create Invoice without Member", "POST", "invoices", 201, invoice_data_no_member)
        
        if result2 and 'id' in result2:
            # Test multiple activities and discount calculation
            # Subtotal: 250 + 350 = 600, After discount: 600 - 50 = 550, VAT: 550 * 0.15 = 82.5, Total: 632.5
            expected_subtotal = 600.0
            expected_after_discount = 550.0
            expected_vat = 82.5
            expected_total = 632.5
            
            if abs(result2.get('subtotal', 0) - expected_subtotal) < 0.01:
                self.log_test("Multiple Activities Subtotal", True, f"Subtotal: {result2.get('subtotal')} SAR")
            else:
                self.log_test("Multiple Activities Subtotal", False, f"Expected {expected_subtotal}, got {result2.get('subtotal')}")
            
            if abs(result2.get('vat_amount', 0) - expected_vat) < 0.01:
                self.log_test("VAT with Discount", True, f"VAT: {result2.get('vat_amount')} SAR")
            else:
                self.log_test("VAT with Discount", False, f"Expected {expected_vat}, got {result2.get('vat_amount')}")
            
            if abs(result2.get('total', 0) - expected_total) < 0.01:
                self.log_test("Total with Discount and VAT", True, f"Total: {result2.get('total')} SAR")
            else:
                self.log_test("Total with Discount and VAT", False, f"Expected {expected_total}, got {result2.get('total')}")
            
            # Test simplified customer fields (no email, no English name)
            if 'customer_email' not in result2 or not result2.get('customer_email'):
                self.log_test("No Email Field", True, "Email field removed as expected")
            else:
                self.log_test("No Email Field", False, "Email field still present")
            
            return result2['id']
        
        return None

    def test_export_endpoints(self):
        """Test new export functionality"""
        print("\n📤 Testing Export Endpoints...")
        
        # Test members export
        members_export = self.run_test("Export Members", "GET", "export/members", 200)
        if members_export is not None:
            self.log_test("Members Export", True, "CSV export successful")
        
        # Test invoices export  
        invoices_export = self.run_test("Export Invoices", "GET", "export/invoices", 200)
        if invoices_export is not None:
            self.log_test("Invoices Export", True, "CSV export successful")
        
        # Test reports export
        reports_export = self.run_test("Export Reports", "GET", "export/reports", 200)
        if reports_export is not None:
            self.log_test("Reports Export", True, "CSV export successful")
        
        return True

    def test_advanced_search(self):
        """Test advanced invoice search functionality"""
        print("\n🔍 Testing Advanced Search...")
        
        # Test search with query parameter
        search_result = self.run_test("Search Invoices", "GET", "invoices/search?q=test", 200)
        if search_result is not None:
            self.log_test("Invoice Search", True, f"Found {len(search_result)} results")
        
        # Test search with status filter
        status_search = self.run_test("Search by Status", "GET", "invoices/search?status=pending", 200)
        if status_search is not None:
            self.log_test("Status Filter Search", True, f"Found {len(status_search)} pending invoices")
        
        # Test search with date range
        today = datetime.now().strftime("%Y-%m-%d")
        date_search = self.run_test("Search by Date", "GET", f"invoices/search?start_date={today}", 200)
        if date_search is not None:
            self.log_test("Date Range Search", True, f"Found {len(date_search)} invoices from today")
        
        return True

    def test_company_info(self):
        """Test company information endpoint"""
        print("\n🏢 Testing Company Info...")
        
        result = self.run_test("Get Company Info", "GET", "company-info", 200)
        
        if result:
            # Check required company fields
            expected_fields = {
                'tax_number': '312655637900003',
                'commercial_reg': '7043630230',
                'vat_rate': 15,
                'name_ar': 'أكاديمية أداء الأبطال العالمية'
            }
            
            for field, expected_value in expected_fields.items():
                if field in result and result[field] == expected_value:
                    self.log_test(f"Company {field}", True, f"Value: {result[field]}")
                else:
                    self.log_test(f"Company {field}", False, f"Expected {expected_value}, got {result.get(field)}")
        
        return result is not None
    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting Sports Academy API Tests")
        print("=" * 50)
        
        # Test seeding first
        if not self.test_seed_data():
            print("⚠️  Seed data failed, but continuing with tests...")
        
        # Test authentication
        if not self.test_login():
            print("❌ Authentication failed - stopping tests")
            return False
        
        # Test all endpoints
        self.test_dashboard_stats()
        activities = self.test_activities()
        self.test_coaches()
        self.test_members()
        self.test_invoices()
        self.test_reports()
        self.test_company_info()
        
        # Test new features
        self.test_export_endpoints()
        self.test_advanced_search()
        
        # Test creation operations
        member_id = self.test_member_creation()
        self.test_invoice_creation(member_id)
        
        return True

    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 50)
        print("📊 TEST SUMMARY")
        print("=" * 50)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "0%")
        
        # Show failed tests
        failed_tests = [r for r in self.test_results if not r['success']]
        if failed_tests:
            print(f"\n❌ Failed Tests ({len(failed_tests)}):")
            for test in failed_tests:
                print(f"  • {test['test']}: {test['details']}")
        
        return self.tests_passed == self.tests_run

def main():
    """Main test function"""
    tester = AcademyAPITester()
    
    try:
        success = tester.run_all_tests()
        tester.print_summary()
        
        # Save results to file
        with open('/app/test_reports/backend_test_results.json', 'w', encoding='utf-8') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'total_tests': tester.tests_run,
                'passed_tests': tester.tests_passed,
                'success_rate': (tester.tests_passed/tester.tests_run*100) if tester.tests_run > 0 else 0,
                'results': tester.test_results
            }, f, indent=2, ensure_ascii=False)
        
        return 0 if success else 1
        
    except KeyboardInterrupt:
        print("\n⚠️  Tests interrupted by user")
        return 1
    except Exception as e:
        print(f"\n💥 Unexpected error: {str(e)}")
        return 1

if __name__ == "__main__":
    sys.exit(main())