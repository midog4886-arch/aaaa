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
    def __init__(self, base_url="https://athletic-hub-56.preview.emergentagent.com"):
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
        """Test creating an invoice with customer data"""
        print("\n💰 Testing Invoice Creation...")
        
        if not member_id:
            # Get first member
            members = self.run_test("Get Members for Invoice", "GET", "members", 200)
            if not members or len(members) == 0:
                self.log_test("Invoice Creation", False, "No members available")
                return False
            member_id = members[0]['id']
        
        # Get activities
        activities = self.run_test("Get Activities for Invoice", "GET", "activities", 200)
        if not activities or len(activities) == 0:
            self.log_test("Invoice Creation", False, "No activities available")
            return False
        
        invoice_data = {
            "member_id": member_id,
            "items": [
                {
                    "activity_id": activities[0]["id"],
                    "activity_name": activities[0]["name_ar"],
                    "fee": activities[0]["monthly_fee"],
                    "period": f"{datetime.now().strftime('%Y-%m-%d')} - {(datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')}"
                }
            ],
            "discount": 0,
            "notes": "Test invoice",
            "payment_method": "cash",
            # Customer data fields (new feature)
            "customer_name": "Test Customer",
            "customer_name_ar": "عميل تجريبي",
            "customer_phone": "0501234567",
            "customer_email": "customer@test.com",
            "customer_address": "Test Address"
        }
        
        result = self.run_test("Create Invoice", "POST", "invoices", 201, invoice_data)
        
        if result and 'id' in result:
            invoice_id = result['id']
            self.log_test("Invoice Created", True, f"ID: {invoice_id}")
            
            # Verify customer data is stored
            if result.get('customer_name') == "Test Customer":
                self.log_test("Customer Data Stored", True, "Customer name saved correctly")
            else:
                self.log_test("Customer Data Stored", False, "Customer data not saved")
            
            return invoice_id
        
        return None

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
        
        # Test creation operations
        member_id = self.test_member_creation()
        if member_id:
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