# أكاديمية أداء الأبطال العالمية - نظام إدارة الأكاديمية الرياضية
## Champions Performance Academy Management System

### Original Problem Statement
نظام إدارة لأكاديمية رياضية تشمل: السباحة، كرة القدم، الكاراتيه، والجمباز.
- نظام تسجيل بيانات المشتركين
- إصدار فواتير ورسوم الاشتراك (الريال السعودي)
- متابعة تواريخ الاشتراك مع تنبيهات
- إرسال رسائل واتساب
- تقسيم المشتركين حسب النشاط/المدرب
- تقارير مالية دورية
- دعم عضو بأكثر من نشاط

### User Personas
1. **موظف الاستقبال** - إدارة الأعضاء والفواتير
2. **مدير الأكاديمية** - التقارير والإحصائيات
3. **المدربين** - عرض قوائم الأعضاء

### Architecture
- **Frontend**: React + Tailwind CSS + Shadcn/UI
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **Authentication**: JWT
- **Payment**: Stripe Integration
- **Design**: RTL Arabic with English toggle, Orange (#F97316) theme

---

## What's Been Implemented ✅

### Phase 1 - MVP (January 2026)

#### Backend API
- [x] JWT Authentication (login/register/me)
- [x] Activities CRUD (4 sports: Swimming, Football, Karate, Gymnastics)
- [x] Coaches CRUD
- [x] Members CRUD with multiple activities support
- [x] Invoices CRUD with multiple activities per invoice
- [x] Stripe Payment Integration (SAR currency)
- [x] Financial Reports API
- [x] Dashboard Statistics API
- [x] Expiring Subscriptions Alert API
- [x] Seed Data endpoint

#### Frontend Pages
- [x] Login Page (Arabic RTL, bilingual support)
- [x] Dashboard (stats, charts, expiring alerts)
- [x] Members Management (CRUD, multiple activities per member)
- [x] Activities Management (4 sports with color coding)
- [x] Coaches Management
- [x] Invoices (create, view, print, Stripe payment)
- [x] Financial Reports (filters, charts)
- [x] Messages (WhatsApp template messaging)
- [x] Settings (language toggle, theme)

#### Features
- [x] Arabic RTL with English toggle
- [x] Orange dynamic design (#F97316)
- [x] Responsive sidebar navigation
- [x] Member with multiple activities
- [x] Per-activity subscription status (active/expired/frozen)
- [x] Invoice with multiple activities detail
- [x] Print-ready invoice format
- [x] Stripe online payment
- [x] Financial charts (Recharts)

---

## Prioritized Backlog

### P0 - Critical (Next)
- [ ] WhatsApp Business API integration (currently template-based)
- [ ] Subscription expiry auto-notifications
- [ ] Email notifications

### P1 - High Priority
- [ ] Multi-user roles (Admin, Receptionist, Coach)
- [ ] Coach dashboard with their members
- [ ] Activity schedule/timetable
- [ ] Attendance tracking

### P2 - Medium Priority
- [ ] Member photo upload
- [ ] PDF invoice export
- [ ] Export reports to Excel
- [ ] SMS notifications (Twilio)

### P3 - Nice to Have
- [ ] Mobile app (React Native)
- [ ] Parent portal for viewing child activities
- [ ] Online registration form
- [ ] Discount/coupon system

---

## Credentials
- **Admin**: username: `admin`, password: `admin123`
- **Seed Data**: Click "إنشاء بيانات تجريبية" on login page

## API Endpoints
- POST /api/auth/login
- POST /api/auth/register
- GET /api/auth/me
- CRUD /api/activities
- CRUD /api/coaches
- CRUD /api/members
- CRUD /api/invoices
- POST /api/payments/checkout
- GET /api/reports/financial
- GET /api/reports/expiring-subscriptions
- GET /api/dashboard/stats
- POST /api/seed

---

## Update 2 - Export and Enhanced Invoice Features (January 2026)

### New Features Added:

#### 1. Export to Excel/CSV
- [x] **Members Export** - Export all members with activities/status to CSV
- [x] **Invoices Export** - Export invoices (filtered or all) to CSV
- [x] **Financial Reports Export** - Export revenue reports to CSV
- All exports include Arabic BOM for proper Excel rendering

#### 2. Advanced Invoice Search
- [x] Search by invoice number, member name, or phone
- [x] Filter by status (paid/pending/cancelled)
- [x] Filter by activity
- [x] Filter by date range (from/to)
- [x] Clear filters button

#### 3. Customer Data in Invoice
- [x] Customer name (Arabic)
- [x] Customer name (English)
- [x] Customer phone
- [x] Customer email
- [x] Customer address
- [x] Auto-fill from member data
- [x] Editable before saving invoice
- [x] Stored with invoice for printing/WhatsApp

#### 4. Member Invoice History
- [x] Tabs in member view (Info, Activities, Invoices)
- [x] List of all member invoices
- [x] Quick view of invoice status and amount

#### 5. WhatsApp Integration Enhancement
- [x] Send invoice via WhatsApp button in list
- [x] Send invoice via WhatsApp in view dialog
- [x] Uses customer phone from invoice data

### API Endpoints Added:
- GET /api/export/members - Export members CSV
- GET /api/export/invoices - Export invoices CSV  
- GET /api/export/reports - Export financial report CSV
- GET /api/invoices/search - Advanced invoice search

---

## Update 3 - Print & Invoice Management Features (January 17, 2026)

### New Features Added:

#### 1. Print Controls ✅
- [x] **Print Members Button** - Print member list with activities and status
- [x] **Print Reports Button** - Print financial reports with summaries

#### 2. Invoice Management ✅
- [x] **Restore Invoice Button** - Restore cancelled invoices to pending status
- [x] **Delete Invoice Button** - Permanently delete invoices (with confirmation)
- [x] **QR Code Display** - Show QR code on electronic invoice view

#### 3. Invoice Print Improvements ✅
- [x] **Smaller Logo** - Reduced logo size from 16x16 to 12x12 for better fit
- [x] **Single Page Layout** - Optimized print styles for A4 single page
- [x] **Compact QR Code** - Reduced QR code size for print view

### API Endpoints Used:
- PUT /api/invoices/{id}/restore - Restore cancelled invoice
- DELETE /api/invoices/{id} - Delete invoice permanently
- GET /api/invoices/{id}/qr - Get QR code for invoice

---

## Update 4 - Logo Removal & Subscription Alerts (January 17, 2026)

### New Features Added:

#### 1. Invoice Print Without Logo ✅
- [x] Removed logo image from invoice print view
- [x] Kept company name and details prominent
- [x] Cleaner, more professional print layout

#### 2. Subscription Expiry Alerts System ✅
- [x] **Expiring Subscriptions List** - Shows members with subscriptions expiring within 7 days
- [x] **Individual WhatsApp Reminder** - Send reminder to specific member with green message icon
- [x] **Bulk Send All Reminders** - "إرسال تنبيهات" button to send reminders to all expiring members
- [x] **Days Remaining Badge** - Red badge for 3 days or less, amber for 4-7 days
- [x] **Arabic WhatsApp Message Template** - Professional reminder message in Arabic

### WhatsApp Reminder Message Template:
```
مرحباً [اسم العضو]،

نود تذكيركم بأن اشتراككم في نشاط "[النشاط]" سينتهي خلال [X] أيام.

نأمل منكم تجديد الاشتراك في أقرب وقت للاستمرار في الاستفادة من خدماتنا.

شكراً لكم،
أكاديمية أداء الأبطال العالمية
```

### Bug Fix:
- Fixed date comparison in expiring subscriptions API (was using ISO format instead of YYYY-MM-DD)

---

## Update 5 - Enhanced Excel Export (January 17, 2026)

### Export Features Enhanced:

#### 1. Members Export (.xlsx) ✅
- **Fields**: م، الاسم، العمر، ولي الأمر، الجوال، البريد، الأنشطة، حالة الاشتراك، تاريخ البداية، تاريخ النهاية
- **Styling**: Orange header with white text, bordered cells
- **Filters**: By activity, by subscription status

#### 2. Invoices Export (.xlsx) ✅
- **Fields**: م، رقم الفاتورة، اسم العميل، الجوال، الأنشطة، المجموع الفرعي، الضريبة، الإجمالي، الحالة، طريقة الدفع، التاريخ
- **Status Translation**: مدفوعة/غير مدفوعة/ملغاة
- **Filters**: By status, by date range

#### 3. Financial Reports Export (.xlsx) ✅
- **Summary Sheet**: إجمالي الإيرادات، إجمالي الضريبة، عدد الفواتير، الإيرادات حسب النشاط
- **Details Sheet**: تفاصيل كل فاتورة مدفوعة
- **Filters**: By date range

#### 4. All Data Export (.xlsx) ✅
- **Multiple Sheets**: الأعضاء، الفواتير، الأنشطة، المدربين
- **Full Backup**: Export complete academy data for analysis

### Technical Details:
- Format: `.xlsx` (Microsoft Excel Open XML)
- Library: `openpyxl`
- Arabic RTL Support: ✅
- Token Authentication: Query parameter support for download links

---

## Update 6 - Multi-Branch Support (January 17, 2026)

### Multi-Branch System Features:

#### 1. Branch Management (Admin Only) ✅
- **CRUD Operations**: Create, Read, Update, Delete branches
- **Branch Data**: Name (AR/EN), Phone, Manager Name (AR/EN), Address, Status (Active/Inactive)
- **Admin-Only Access**: Only admin users can access branch management page

#### 2. Data Isolation by Branch ✅
- **Members**: Each member belongs to a specific branch
- **Invoices**: Each invoice is linked to the branch where it was created
- **Activities**: Activities can be branch-specific or shared
- **Coaches**: Coaches can be assigned to specific branches
- **Reports**: Financial reports are filtered by branch

#### 3. User Access Control ✅
- **Admin Users**: Can see all branches and all data across branches
- **Regular Users**: Can only see data from their assigned branch
- **Token-Based**: Branch ID and admin status stored in JWT token

#### 4. Navigation ✅
- **Branches Page**: New menu item "الفروع" visible only to admin users
- **URL**: `/branches`

### Database Schema Changes:
- Added `branch_id` field to: `members`, `invoices`, `activities`, `coaches`
- Added `branch_id` and `is_admin` fields to `users` collection
- New `branches` collection with branch details

### API Endpoints Added:
- `GET /api/branches` - Get all branches (admin) or user's branch
- `POST /api/branches` - Create new branch (admin only)
- `PUT /api/branches/{id}` - Update branch (admin only)
- `DELETE /api/branches/{id}` - Delete branch (admin only)
- `GET /api/branches/{id}` - Get single branch

### Default Admin Credentials:
- Username: `admin`
- Password: `admin123`
- Role: Admin (can see all branches)

---

## Update 7 - Users Management & Simplified Branches (January 17, 2026)

### Users Management System ✅

#### 1. Users Page (Admin Only)
- **URL**: `/users`
- **Features**:
  - View all system users in a table
  - Add new users with: username, full name, password, branch, admin role
  - Edit existing users (name, branch, admin status, password)
  - Delete users (cannot delete yourself)
  - Assign users to specific branches
  - Grant/revoke admin privileges

#### 2. User Data Fields
- **Username**: Login credential (unique)
- **Full Name**: Display name
- **Password**: Encrypted with bcrypt
- **Branch**: Assigned branch (optional for admins)
- **Is Admin**: Boolean - admin sees all branches

### Simplified Branch Form ✅
- Reduced to only 2 fields:
  - **Branch Name** (required)
  - **Phone Number** (required)
- Removed: Manager name, address, active status toggle

### API Endpoints Added:
- `GET /api/users` - Get all users (admin only)
- `POST /api/users/create` - Create new user (admin only)
- `PUT /api/users/{id}` - Update user (admin only)
- `DELETE /api/users/{id}` - Delete user (admin only)

### Navigation:
- "المستخدمين" (Users) link visible only to admin users

---

## Update 8 - Schedule Field & Payment Methods (January 2025)

**Completed Tasks (January 2025)**:
    -   ✅ **Schedule Field Fix**: Added `schedule` field to `InvoiceItem` model in backend. Now saves and displays correctly in invoices.
    -   ✅ **Tabby & Tamara Payment Methods**: Added as payment method options in invoice creation form (no electronic integration - display only).

**Upcoming Tasks**:
    -   **WhatsApp Business API Integration (P1)**: Send invoice images directly via WhatsApp API. User has provided phone number: 00966566238384. Waiting for Access Token and Phone Number ID from Meta Business Suite.
