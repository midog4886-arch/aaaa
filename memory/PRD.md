# شركة اداء الابطال العالمية للرياضة - نظام إدارة الشركة الرياضية
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
شركة اداء الابطال العالمية للرياضة
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
    -   ✅ **Admin-Only Delete**: Invoice deletion is now restricted to admin users only.
    -   ✅ **Refund Feature**: Added full and partial refund functionality for paid invoices.
        - New refund dialog with type selection (full/partial)
        - Partial refund allows custom amount input
        - Refund reason field (optional)
        - New invoice statuses: "refunded" and "partially_refunded"
        - API endpoint: `POST /api/invoices/{id}/refund`
        - Refunds stored in `refunds` collection in MongoDB
    -   ✅ **Refunds Report**: Added comprehensive refunds reporting to Reports page:
        - Summary cards: Total Revenue, Total Refunds, Net Revenue, Invoice Count
        - Refunds Summary section with counts (total, full, partial)
        - Detailed refunds table with invoice #, customer, amounts, type, reason, date
        - Updated print function to include refunds details
        - API updated: `/api/reports/financial` now returns refund data
    -   ✅ **Interactive Report Cards**: All summary cards are now clickable to show details:
        - إجمالي الإيرادات (Total Revenue) → Shows revenue breakdown by activity
        - إجمالي المسترجع (Total Refunds) → Shows refund operations details table
        - صافي الإيرادات (Net Revenue) → Shows calculation breakdown (Revenue - Refunds = Net)
        - الفواتير (Invoices) → Shows list of paid invoices with payment methods
    -   ✅ **Interactive Dashboard Cards**: All dashboard summary cards are now clickable:
        - إجمالي الأعضاء (Total Members) → Shows members list with details
        - الاشتراكات النشطة (Active Subscriptions) → Shows activities and subscription counts
        - إيرادات الشهر (Monthly Revenue) → Shows revenue, refunds, and net revenue breakdown
        - ينتهي قريباً (Expiring Soon) → Shows expiring subscriptions with WhatsApp reminder buttons
    -   ✅ **Edit Invoice Before Payment**: Added edit button for pending invoices to modify items, customer info, discounts
    -   ✅ **PDF Invoice Export**: Added "Save PDF & Share" button to save invoice as PDF and open WhatsApp for sharing
    -   ✅ **Store/Inventory Management**: New page for managing products (swimming equipment, sports accessories)
        - Product CRUD operations with categories
        - Stock management (add/remove inventory)
        - Low stock alerts
        - Product cards with price, cost, quantity display
    -   ✅ **Clickable Store Cards**: All store stat cards are now interactive showing details:
        - Total Products → Shows breakdown by category
        - Low Stock → Shows list of products needing restock
        - Sale Value / Cost Value → Shows profit calculation
        - Active Coupons → Opens discount coupons tab
    -   ✅ **Discount Coupons System**: Full coupon management system:
        - Create/edit/delete discount coupons
        - Percentage or fixed amount discounts
        - Minimum purchase requirement
        - Usage limits (max uses)
        - Active/inactive status
        - Validate coupon API endpoint

**Upcoming Tasks**:
    -   **WhatsApp Business API Integration (P1)**: Send invoice images directly via WhatsApp API. User has provided phone number: 00966566238384. Waiting for Access Token and Phone Number ID from Meta Business Suite.

---

## Update 9 - Invoice Store & Discount Integration (January 19, 2026)

### New Features Added:

#### 1. Products in Invoices ✅
- **Item Type Selector**: Toggle between "الأنشطة" (Activities) and "المنتجات" (Products) tabs
- **Product Selection**: Dropdown to add products from store inventory to invoice
- **Quantity Support**: Adjust product quantity with automatic price calculation
- **Visual Distinction**: Products highlighted with green border and "منتج" badge
- **Stock Validation**: Cannot add more than available stock

#### 2. Discount Coupons in Invoices ✅
- **Coupon Input Field**: Enter discount coupon code
- **Validate & Apply**: Button to validate coupon against backend
- **Applied Coupon Display**: Shows coupon code, discount type (percentage/fixed), and amount
- **Remove Coupon**: Easy removal of applied coupon
- **Subtotal Check**: Cannot apply coupon without items in invoice

#### 3. Enhanced Invoice Calculation ✅
- **Total Discount**: Combines manual discount + coupon discount
- **VAT Calculation**: Applied after all discounts
- **Visual Breakdown**: Shows subtotal, manual discount, coupon discount, VAT, and final total

#### 4. Automatic Stock & Coupon Tracking ✅
- **Stock Deduction**: When invoice is marked as paid, product stock is automatically reduced
- **Coupon Usage Count**: Incremented when invoice with coupon is paid
- **Usage Limit Check**: Validates coupon hasn't exceeded max uses

### Backend Model Updates:
- `InvoiceItem`: Added `is_product`, `product_id`, `quantity` fields
- `InvoiceCreate`: Added `discount_code` field
- `create_invoice`: Saves `discount_code` for tracking
- `pay_invoice`: Deducts stock and increments coupon usage

### Test Coverage:
- 10/10 backend tests passing (100%)
- Tests cover: activities, products, coupons, validation, stock deduction, usage tracking

### Files Modified:
- `/app/frontend/src/pages/InvoicesPage.js` - UI for products and coupons
- `/app/backend/server.py` - Models and API logic


---

## Update 10 - Admin Branch Switching & Branch-Specific Coupons (January 20, 2026)

### New Features Added:

#### 1. Admin Branch Switching ✅
- **Branch Selector Dropdown**: Admin users can see a dropdown in the sidebar to switch between branches
- **Persistent Selection**: Selected branch is saved in localStorage and survives page refresh
- **Visual Indicator**: Shows "التنقل بين الفروع" label with branch icon
- **All Branches Option**: "جميع الفروع" option to view data across all branches

#### 2. Data Filtering by Branch ✅
- **Dashboard**: Members count, revenue, coupons count update based on selected branch
- **Members Page**: Filters members list by selected branch
- **Invoices Page**: Filters invoices by selected branch
- **Store/Products**: Filters products and coupons by selected branch
- **Reports Page**: Financial reports filter by selected branch
- **Expiring Subscriptions**: Filters by selected branch

#### 3. Branch-Specific Coupons ✅
- **Branch Selection in Coupon Form**: Admin can specify which branch a coupon belongs to
- **Global Coupons**: "جميع الفروع (كوبون عام)" option for coupons valid across all branches
- **Branch Display in Coupon List**: Shows branch name for each coupon
- **Backend Support**: `DiscountCreate` model updated with `branch_id` field

### Backend API Updates:
- All data endpoints now accept `branch_filter` query parameter for admin users
- `GET /api/dashboard/stats?branch_filter={branch_id}` - Dashboard stats by branch
- `GET /api/members?branch_filter={branch_id}` - Members by branch
- `GET /api/invoices?branch_filter={branch_id}` - Invoices by branch
- `GET /api/discounts?branch_filter={branch_id}` - Discounts by branch
- `GET /api/products?branch_filter={branch_id}` - Products by branch
- `POST /api/discounts` - Now accepts `branch_id` for branch-specific coupons

### Files Modified:
- `/app/backend/server.py` - Added `branch_filter` parameter to all data endpoints
- `/app/frontend/src/contexts/AuthContext.js` - Added `selectedBranchId` and `switchBranch`
- `/app/frontend/src/components/Layout.js` - Added branch selector dropdown for admin
- `/app/frontend/src/pages/DashboardPage.js` - Uses `selectedBranchId` for API calls
- `/app/frontend/src/pages/MembersPage.js` - Uses `selectedBranchId` for API calls
- `/app/frontend/src/pages/InvoicesPage.js` - Uses `selectedBranchId` for API calls
- `/app/frontend/src/pages/ReportsPage.js` - Uses `selectedBranchId` for API calls
- `/app/frontend/src/pages/StorePage.js` - Branch selection in coupon form
- `/app/frontend/src/services/api.js` - Updated APIs with params support

### Test Coverage:
- 12/12 backend tests passing (100%)
- Tests include: admin branch switching, data filtering, coupon creation with branch, non-admin access restriction

### Bug Fixes:
- Fixed: Dashboard month_revenue was not filtering by branch for admin (line 1592-1596 in server.py)

---

## Prioritized Backlog (Updated January 20, 2026)

### P0 - Critical (Completed)
- [x] Admin Branch Switching
- [x] Branch-Specific Coupons

### P1 - High Priority
- [ ] WhatsApp Business API Integration (Waiting for user's Access Token and Phone Number ID)

### P2 - Medium Priority
- [ ] Activity Timetable Management
- [ ] Attendance Tracking
- [ ] Advanced User Permissions

### P3 - Nice to Have / Refactoring
- [ ] Split monolithic server.py into routes/models/services
- [ ] Refactor InvoicesPage.js (very large file)
- [ ] Refactor StorePage.js (very large file)

---

## Update 12 - Members Sorting & Invoice Member Registration (January 26, 2026)

### Features Implemented:

#### 1. ترتيب الأعضاء حسب الأحدث ✅
- **الوصف**: قائمة الأعضاء الآن مرتبة تنازلياً حسب تاريخ الإضافة
- **الملف**: `/app/backend/server.py` - تمت إضافة `.sort("created_at", -1)` لـ endpoint الأعضاء
- **النتيجة**: الأعضاء الجدد يظهرون في أعلى القائمة

#### 2. تسجيل العضو مع النشاط من الفاتورة ✅
- **الوصف**: عند إنشاء عضو جديد من صفحة الفاتورة، يتم تسجيله مع الأنشطة المحددة في الفاتورة
- **الملف**: `/app/frontend/src/pages/InvoicesPage.js` - تم تعديل دالة `handleCreateMember`
- **السلوك**: 
  - الأنشطة المضافة للفاتورة تُنقل تلقائياً للعضو الجديد
  - حالة النشاط تُعيَّن كـ "active"
  - تواريخ البداية والنهاية تُنسخ من بيانات الفاتورة

### Files Modified:
- `/app/backend/server.py` - Line 708: Added sorting by `created_at` descending
- `/app/frontend/src/pages/InvoicesPage.js` - Lines 311-345: Updated `handleCreateMember` function

### API Changes:
- `GET /api/members` - Now returns members sorted by `created_at` descending (newest first)

---

## Update 13 - PDF Button, Active Members Filter, Member Status (January 26, 2026)

### Features Implemented:

#### 1. زر "حفظ PDF فقط" ✅
- **الوصف**: زر جديد لحفظ الفاتورة كـ PDF بدون فتح واتساب
- **الملف**: `/app/frontend/src/pages/InvoicesPage.js`
- **الدالة**: `handleSaveAsPdfOnly` - تحفظ PDF مباشرة بدون أي إجراء إضافي
- **الموقع**: نافذة عرض الفاتورة - زر أزرق "حفظ PDF"

#### 2. المستلمون في الرسائل - الأعضاء الناشطون فقط ✅
- **الوصف**: صفحة الرسائل الآن تعرض فقط الأعضاء الذين لديهم نشاط واحد على الأقل بحالة "active"
- **الملف**: `/app/frontend/src/pages/MessagesPage.js`
- **الفلترة**: `member.activities?.some(a => a.status === 'active')`

#### 3. عمود حالة العضو الإجمالية ✅
- **الوصف**: عمود جديد "حالة العضو" في جدول الأعضاء يعرض الحالة الإجمالية
- **الملف**: `/app/frontend/src/pages/MembersPage.js`
- **الحالات**:
  - 🟢 **نشط** - لديه نشاط واحد على الأقل بحالة active
  - 🔴 **منتهي** - جميع أنشطته منتهية
  - ⚪ **بدون نشاط** - لا يوجد أنشطة مسجلة

### Files Modified:
- `/app/frontend/src/pages/InvoicesPage.js` - Added `handleSaveAsPdfOnly` function and "حفظ PDF" button
- `/app/frontend/src/pages/MessagesPage.js` - Filter only active members
- `/app/frontend/src/pages/MembersPage.js` - Added `getMemberOverallStatus` function and status column

---

## Update 14 - Registration Form & Invoice-Based Member Status (January 26, 2026)

### Features Implemented:

#### 1. زر استمارة تسجيل (أبيض وأسود بدون QR) ✅
- **الوصف**: زر جديد باللون الأسود لطباعة استمارة تسجيل رسمية
- **الملف**: `/app/frontend/src/pages/InvoicesPage.js`
- **الدالة**: `handlePrintRegistrationForm`
- **المميزات**:
  - تصميم أبيض وأسود للطباعة
  - بدون رمز QR
  - يتضمن بيانات المشترك والأنشطة والمبالغ
  - مكان للتوقيع (المشترك/ولي الأمر والموظف)
  - الشروط والأحكام

#### 2. تحديث أنشطة العضو عند دفع الفاتورة ✅
- **الوصف**: عند الضغط على "تم الدفع"، يتم تحديث أنشطة العضو تلقائياً
- **الملف**: `/app/backend/server.py` - دالة `pay_invoice`
- **السلوك**:
  - استخراج الأنشطة من بنود الفاتورة
  - تحديث تاريخ البداية والنهاية من الفاتورة
  - تحديد الحالة (active/expired) بناءً على تاريخ الانتهاء
  - إضافة نشاط جديد أو تحديث نشاط موجود

#### 3. تحديد حالة العضو من تاريخ انتهاء النشاط ✅
- **الوصف**: حالة العضو تُحسب تلقائياً من تاريخ انتهاء كل نشاط
- **الملف**: `/app/frontend/src/pages/MembersPage.js`
- **الدوال**: `getMemberOverallStatus`, `getActivityStatusFromDate`
- **المنطق**:
  - إذا كان تاريخ الانتهاء >= اليوم → نشط (أخضر)
  - إذا كان تاريخ الانتهاء < اليوم → منتهي (أحمر)

### Files Modified:
- `/app/backend/server.py` - Updated `pay_invoice` to sync member activities
- `/app/frontend/src/pages/InvoicesPage.js` - Added registration form button and function
- `/app/frontend/src/pages/MembersPage.js` - Status calculation based on end_date




---

## Update 15 - Invoice Supervisor Field (January 27, 2026)

### Features Implemented:

#### 1. حقل مشرف الفاتورة (supervisor_name) ✅
- **الوصف**: حقل جديد يُسجل اسم الموظف الذي أنشأ الفاتورة تلقائياً
- **الملف Backend**: `/app/backend/server.py`
  - `create_invoice` - يجلب اسم المستخدم من قاعدة البيانات ويحفظه في الفاتورة
  - `convert_registration_form` - يضيف اسم المشرف عند تحويل استمارة التسجيل
- **الملف Frontend**: `/app/frontend/src/pages/InvoicesPage.js`
  - يعرض حقل "👤 مشرف الفاتورة" في قسم معلومات الدفع
  - يظهر في نافذة عرض الفاتورة وعند الطباعة

### Backend Changes:
- **Invoice Model**: حقل `supervisor_name: Optional[str] = ""` موجود مسبقاً
- **create_invoice endpoint** (line ~976): 
  ```python
  user_doc = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0})
  supervisor_name = user_doc.get("name", current_user.get("username", ""))
  ```
- **convert_registration_form endpoint** (line ~1259): نفس المنطق لإضافة اسم المشرف

### Frontend Changes:
- **InvoicesPage.js** (line ~1879-1882): عرض حقل المشرف في قسم معلومات الدفع
  ```jsx
  {selectedInvoice.supervisor_name && (
    <div className="col-span-2 mt-2 pt-2 border-t border-blue-200">
      <strong>👤 مشرف الفاتورة:</strong> {selectedInvoice.supervisor_name}
    </div>
  )}
  ```

### Bug Fix:
- إصلاح خطأ توليد رقم الفاتورة عند وجود أرقام بصيغة "INV-XXXXX"
- الآن يتعامل مع كلا الصيغتين (الرقمية و INV-XXXXX)

### Test Results:
- ✅ 5/5 اختبارات ناجحة (100%)
- ✅ إنشاء فاتورة يحفظ supervisor_name تلقائياً
- ✅ تحويل استمارة يحفظ supervisor_name
- ✅ الفواتير القديمة تعمل بدون أخطاء
- ✅ حقل المشرف يظهر في الواجهة

### Files Modified:
- `/app/backend/server.py` - Lines 976-978, 1259-1261
- `/app/frontend/src/pages/InvoicesPage.js` - Lines 1879-1882

---

## Prioritized Backlog (Updated January 27, 2026)

### P0 - Critical (Completed)
- [x] Invoice Supervisor Field (supervisor_name)

### P1 - High Priority
- [ ] WhatsApp Business API Integration (User's Access Token & Phone Number ID required)

### P2 - Medium Priority
- [ ] Activity Timetable Management
- [ ] Attendance Tracking
- [ ] Advanced User Permissions

### P3 - Refactoring
- [ ] Split monolithic server.py into routes/models/services
- [ ] Refactor InvoicesPage.js (very large file)
- [ ] Refactor StorePage.js (very large file)


---

## Update 16 - Dashboard Pending Forms Card & Registration Form Enhancements (January 27, 2026)

### Features Implemented:

#### 1. كرت استمارات التسجيل الغير مفوترة في لوحة التحكم ✅
- **الوصف**: كرت جديد في Dashboard يعرض إجمالي مبالغ استمارات التسجيل التي لم يتم تحويلها إلى فواتير
- **الملف Backend**: `/app/backend/server.py` - get_dashboard_stats
- **الملف Frontend**: `/app/frontend/src/pages/DashboardPage.js`
- **المميزات**:
  - يعرض المبلغ الإجمالي وعدد الاستمارات
  - لون تركواز مميز
  - عند الضغط عليه يعرض تفاصيل الاستمارات

#### 2. إزالة الضريبة من استمارة التسجيل ✅
- **الوصف**: الإجمالي في الاستمارة = المجموع الفرعي - الخصم (بدون ضريبة)
- **الملف**: `/app/frontend/src/pages/InvoicesPage.js`
- **ملاحظة**: تظهر رسالة "الأسعار لا تشمل ضريبة القيمة المضافة" في الاستمارة

#### 3. فصل زر الحفظ عن الطباعة ✅
- **الوصف**: زران منفصلان في نموذج استمارة التسجيل
- **الأزرار**:
  - "حفظ الاستمارة" (تركواز) - يحفظ فقط بدون طباعة
  - "حفظ وطباعة" (رمادي غامق) - يحفظ ويطبع
- **الدوال**: `handleSaveRegistrationFormOnly`, `handlePrintNewRegistrationForm`

#### 4. رأسية جديدة للاستمارة ✅
- **الوصف**: تصميم جديد للاستمارة المطبوعة مع رأسية (header-banner)
- **المميزات**:
  - خلفية متدرجة باللون الأزرق
  - اسم الشركة بخط كبير
  - اسم الفرع في شريط منفصل
  - تصميم عصري ومهني

### Backend API Updates:
- `GET /api/dashboard/stats` - إضافة حقول:
  - `pending_forms_total`: إجمالي مبالغ الاستمارات الغير مفوترة
  - `pending_forms_count`: عدد الاستمارات الغير مفوترة

### Test Results:
- ✅ 9/9 اختبارات ناجحة (100%)

### Files Modified:
- `/app/backend/server.py` - Lines ~1930-1960
- `/app/frontend/src/pages/DashboardPage.js` - كرت pendingForms الجديد
- `/app/frontend/src/pages/InvoicesPage.js` - Lines ~1024-1200, 2318-2360


---

## Update 17 - View & Edit Registration Forms (January 27, 2026)

### Features Implemented:

#### 1. عرض استمارة التسجيل ✅
- **الوصف**: نافذة جديدة لعرض كامل تفاصيل استمارة التسجيل
- **المكونات المعروضة**:
  - بيانات المشترك (الاسم، الجوال، التاريخ، الحالة)
  - جدول البنود (البند، الفترة، المواعيد، المبلغ)
  - المجموع الفرعي والإجمالي
  - طريقة الدفع والملاحظات
  - أزرار إجراءات (تعديل، تحويل إلى فاتورة) للاستمارات pending

#### 2. تعديل استمارة التسجيل ✅
- **الوصف**: نافذة تعديل كاملة لاستمارات التسجيل بحالة pending
- **إمكانيات التعديل**:
  - تعديل بيانات المشترك (الاسم، الجوال)
  - إضافة/حذف/تعديل البنود (أنشطة ومنتجات)
  - تعديل الأسعار
  - تغيير طريقة الدفع
  - تعديل الملاحظات
- **القيود**: لا يمكن تعديل الاستمارات المحولة (converted)

### Backend API:
- `PUT /api/registration-forms/{form_id}` - تحديث استمارة التسجيل
  - يقبل: RegistrationFormCreate model
  - يُرجع 400 إذا كانت الاستمارة محولة
  - يُرجع 404 إذا لم توجد الاستمارة

### Frontend Changes:
- **أزرار جديدة في جدول الاستمارات**:
  - 👁️ عرض (رمادي) - يظهر لجميع الاستمارات
  - ✏️ تعديل (برتقالي) - يظهر فقط للاستمارات pending
- **نافذتان جديدتان**:
  - `isViewRegFormDialogOpen` / `selectedRegForm` - للعرض
  - `isEditRegFormDialogOpen` / `editRegFormId` - للتعديل
- **دوال جديدة**:
  - `handleViewRegForm(form)`
  - `handleEditRegForm(form)`
  - `handleSaveEditedRegForm()`
  - `closeEditRegFormDialog()`

### Test Results:
- ✅ 100% Backend (8/8 tests)
- ✅ 100% Frontend

### Files Modified:
- `/app/backend/server.py` - Lines ~1269-1310
- `/app/frontend/src/services/api.js` - registrationFormsAPI.update
- `/app/frontend/src/pages/InvoicesPage.js` - View & Edit dialogs



---

## Update 18 - Accounting System (January 28, 2026)

### Features Implemented:

#### 1. شجرة الحسابات (Chart of Accounts) ✅
- **الوصف**: نظام كامل لإدارة الحسابات المحاسبية
- **الحسابات الافتراضية**: 41 حساب مقسم إلى:
  - الأصول (1xxx): الصندوق، البنك، المخزون، ضريبة المدخلات، الأصول الثابتة
  - الخصوم (2xxx): حسابات الموردين، ضريبة المخرجات، إيرادات مؤجلة
  - حقوق الملكية (3xxx): رأس المال، الأرباح المحتجزة
  - الإيرادات (4xxx): إيرادات الاشتراكات (سباحة، كرة قدم، كاراتيه، جمباز)، مبيعات
  - المصروفات (5xxx): المشتريات، الرواتب، الإيجارات، المصاريف الإدارية

#### 2. إدارة الموردين (Suppliers) ✅
- **البيانات**: الاسم، الجوال، البريد، العنوان، الرقم الضريبي، السجل التجاري
- **المالية**: حد الائتمان، مدة السداد، إجمالي المشتريات، المدفوع، الرصيد المستحق
- **العمليات**: إضافة، تعديل، حذف، كشف حساب

#### 3. فواتير المشتريات (Purchase Invoices) ✅
- **البيانات الأساسية**: رقم الفاتورة، المورد، التاريخ، تاريخ الاستحقاق
- **البنود**: المنتج/الوصف، الكمية، سعر الوحدة، نسبة الضريبة
- **الحسابات**: المجموع الفرعي، ضريبة القيمة المضافة 15%، الإجمالي
- **الحالة**: معلقة، جزئي، مدفوعة
- **القيد التلقائي**: إنشاء قيد محاسبي تلقائياً عند حفظ الفاتورة

#### 4. القيود المحاسبية (Journal Entries) ✅
- **القيود التلقائية**: من فواتير المشتريات والسداد
- **القيود اليدوية**: إمكانية إنشاء قيود يدوية
- **التحقق**: رفض القيود غير المتوازنة (المدين ≠ الدائن)
- **الأنواع**: يومية المشتريات، المبيعات، العامة، المدفوعات، المقبوضات

#### 5. سداد الموردين (Supplier Payments) ✅
- **طرق الدفع**: نقدي، تحويل بنكي، شيك
- **السداد**: جزئي أو كامل
- **التحديث التلقائي**: رصيد المورد وحالة الفاتورة
- **القيد التلقائي**: إنشاء قيد سداد تلقائياً

#### 6. واجهة المحاسبة (Accounting UI) ✅
- **التبويبات**: 6 تبويبات (شجرة الحسابات، الموردين، فواتير المشتريات، السداد، القيود، التقارير)
- **الملخصات**: كروت إحصائية لكل قسم
- **الفلاتر**: بالتاريخ، المورد، نوع اليومية
- **مؤشر التوازن**: عرض حالة توازن القيود

### Backend Models Added:
- `Account` / `AccountCreate` - شجرة الحسابات
- `Supplier` / `SupplierCreate` - الموردين
- `PurchaseInvoice` / `PurchaseInvoiceCreate` / `PurchaseInvoiceItem` - فواتير المشتريات
- `JournalEntry` / `JournalEntryCreate` / `JournalEntryLine` - القيود المحاسبية
- `SupplierPaymentCreate` - سداد الموردين

### Backend API Endpoints Added:
- `GET/POST /api/accounts` - شجرة الحسابات
- `POST /api/accounts/seed-default` - إنشاء الحسابات الافتراضية
- `GET/POST/PUT/DELETE /api/suppliers` - الموردين
- `GET /api/suppliers/{id}/statement` - كشف حساب المورد
- `GET/POST/PUT/DELETE /api/purchase-invoices` - فواتير المشتريات
- `GET/POST /api/supplier-payments` - سداد الموردين
- `GET/POST/DELETE /api/journal-entries` - القيود المحاسبية
- `GET /api/reports/journal-entries` - تقرير القيود
- `GET /api/reports/suppliers-balance` - تقرير أرصدة الموردين
- `GET /api/reports/purchases` - تقرير المشتريات

### Frontend Files Added:
- `/app/frontend/src/pages/AccountingPage.js` - صفحة المحاسبة الكاملة

### Frontend Files Modified:
- `/app/frontend/src/services/api.js` - إضافة APIs المحاسبة
- `/app/frontend/src/App.js` - إضافة route المحاسبة
- `/app/frontend/src/components/Layout.js` - إضافة رابط المحاسبة
- `/app/frontend/src/contexts/LanguageContext.js` - إضافة ترجمة "المحاسبة"

### Test Results:
- ✅ 100% Backend (19/19 tests passed)
- ✅ 100% Frontend

### Accounting Standards Compliance:
- ✅ نظام القيد المزدوج (Double Entry)
- ✅ التوازن (المدين = الدائن)
- ✅ ضريبة القيمة المضافة 15%
- ✅ شجرة حسابات معيارية

---

## Prioritized Backlog (Updated January 28, 2026)

### P0 - Critical (Completed)
- [x] Accounting System (Chart of Accounts, Suppliers, Purchase Invoices, Journal Entries)

### P1 - High Priority
- [ ] WhatsApp Business API Integration (Waiting for user's Access Token and Phone Number ID)
- [ ] ربط فواتير الاشتراكات بالقيود المحاسبية تلقائياً (Auto journal entries for subscription invoices)

### P2 - Medium Priority
- [ ] Activity Timetable Management
- [ ] Attendance Tracking
- [ ] Advanced User Permissions
- [x] تقرير الأرباح والخسائر (P&L Report) - تم ضمن تقرير المبيعات
- [ ] تقرير الميزانية العمومية (Balance Sheet)

### P3 - Refactoring
- [ ] Split monolithic server.py into routes/models/services
- [ ] Refactor InvoicesPage.js (very large file)
- [ ] Refactor StorePage.js (very large file)
- [ ] Refactor AccountingPage.js (large file)

---

## Update 19 - VAT & Sales Reports with Excel Export (January 28, 2026)

### Features Implemented:

#### 1. إقرار ضريبة القيمة المضافة (VAT Report) ✅
- **المبيعات (ضريبة المخرجات)**: عدد الفواتير، الصافي، الضريبة 15%، الإجمالي
- **المشتريات (ضريبة المدخلات)**: عدد الفواتير، الصافي، الضريبة 15%، الإجمالي
- **ملخص الإقرار**: صافي الضريبة المستحقة (المخرجات - المدخلات)
- **حالة الضريبة**: "مستحقة للهيئة" أو "رصيد لصالح المنشأة"

#### 2. تقرير فواتير المبيعات ✅
- **الملخص**: عدد الفواتير، الصافي، الخصم، الضريبة، الإجمالي
- **حسب طريقة الدفع**: card, cash, tabby مع عدد الفواتير والإجمالي
- **حسب النشاط**: كل نشاط مع عدد الاشتراكات والإيرادات

#### 3. تصدير Excel ✅
- **Export Sales Report**: تقرير المبيعات مع كل الفواتير
- **Export Purchases Report**: تقرير المشتريات مع كل الفواتير
- **Export VAT Report**: إقرار الضريبة الكامل

### Backend API Endpoints Added:
- `GET /api/reports/vat` - إقرار ضريبة القيمة المضافة
- `GET /api/reports/sales` - تقرير فواتير المبيعات
- `GET /api/export/sales` - تصدير تقرير المبيعات إلى Excel
- `GET /api/export/purchases` - تصدير تقرير المشتريات إلى Excel
- `GET /api/export/vat` - تصدير إقرار الضريبة إلى Excel

### Frontend Updates:
- تبويب جديد "إقرار الضريبة" في صفحة المحاسبة
- قسم تقرير المبيعات مع زر Export Excel
- قسم تقرير المشتريات مع زر Export Excel
- فلاتر التاريخ لكل التقارير

### Test Results:
- ✅ VAT Report API - Working
- ✅ Sales Report API - Working
- ✅ Excel Export - All 3 reports generating valid .xlsx files
- ✅ Frontend UI - All tabs and reports displaying correctly


---

## Update 20 - Feature Verification (January 29, 2026)

### التحقق من المميزات الموجودة ✅

#### 1. عرض أنشطة العضو في نموذج الفاتورة ✅
- **الحالة**: الميزة تعمل بشكل صحيح
- **الوصف**: عند اختيار عضو في نموذج إنشاء الفاتورة، تظهر قائمة بأنشطته الحالية
- **المكونات**:
  - قسم "أنشطة [اسم العضو] الحالية" باللون الأزرق
  - عرض كل نشاط مع: اسم النشاط، التواريخ (من → إلى)، الحالة (نشط/منتهي)، السعر
  - زر "+ إضافة" لإضافة النشاط للفاتورة مباشرة
  - علامة "✓ مضاف" للأنشطة المضافة مسبقاً
- **الملف**: `/app/frontend/src/pages/InvoicesPage.js` (Lines 1967-2022)

#### 2. إضافة مورد جديد وتحديث القائمة ✅
- **الحالة**: الميزة تعمل بشكل صحيح
- **الوصف**: عند إضافة مورد جديد، يظهر فوراً في القائمة بدون الحاجة لتحديث الصفحة
- **الملف**: `/app/frontend/src/pages/AccountingPage.js` (Function: handleSaveSupplier)

---

## Update 21 - نظام تجديد الاشتراك (January 29, 2026)

### الميزة الجديدة: نظام تجديد الاشتراك الكامل ✅

#### 1. عرض الأنشطة مع الأيام المتبقية ✅
- **الوصف**: في صفحة تفاصيل العضو، يتم عرض كل نشاط مع:
  - شارة الأيام المتبقية (أخضر > 7 أيام، أصفر 4-7 أيام، أحمر ≤ 3 أيام أو منتهي)
  - خلفية ملونة للتنبيه (أصفر للقريب من الانتهاء، أحمر للمنتهي)
- **الملف**: `/app/frontend/src/pages/MembersPage.js`

#### 2. زر التجديد ✅
- **الوصف**: يظهر زر "تجديد" أمام كل نشاط منتهي أو قارب على الانتهاء (7 أيام أو أقل)
- **المظهر**: زر أحمر للمنتهي، زر أصفر للقريب من الانتهاء
- **الملف**: `/app/frontend/src/pages/MembersPage.js` (Lines 895-912)

#### 3. نافذة تجديد الاشتراك ✅
- **الوصف**: عند الضغط على "تجديد" يفتح نموذج يحتوي على:
  - معلومات النشاط والعضو
  - تاريخ انتهاء الاشتراك القديم
  - تاريخ البداية الجديد (اليوم التالي لانتهاء القديم تلقائياً)
  - تاريخ النهاية الجديد (شهر بعد البداية تلقائياً)
  - الرسوم (قابلة للتعديل)
  - طريقة الدفع (نقد، بطاقة، تحويل، Tabby، Tamara)
  - ملاحظات اختيارية
  - حساب الضريبة والإجمالي تلقائياً
- **الملف**: `/app/frontend/src/pages/MembersPage.js` (Lines 1043-1180)

#### 4. إنشاء فاتورة تلقائية ✅
- **الوصف**: عند تأكيد التجديد، يتم:
  - إنشاء فاتورة جديدة مدفوعة للعضو
  - إضافة فترة اشتراك جديدة للنشاط
  - الاحتفاظ بالفترة القديمة (لا يتم حذفها)
  - ربط الفترة الجديدة برقم الفاتورة

#### 5. سجل التجديدات ✅
- **الوصف**: تبويب جديد "سجل التجديدات" يعرض:
  - كل فترات الاشتراك لكل نشاط
  - التواريخ والمبالغ والحالات
  - شارة "تجديد" للفترات المجددة
  - خلفية خضراء للنشط، رمادية للمنتهي
- **الملف**: `/app/frontend/src/pages/MembersPage.js` (Lines 953-1040)

### الدوال الجديدة:
- `getDaysRemaining(endDate)` - حساب الأيام المتبقية
- `needsRenewal(activity)` - التحقق من الحاجة للتجديد
- `openRenewalDialog(activity)` - فتح نافذة التجديد
- `handleRenewal()` - تنفيذ التجديد وإنشاء الفاتورة
- `getActivityHistory(activityId)` - جلب سجل التجديدات

### Test Results:
- ✅ Days remaining badge showing correctly
- ✅ Renew button appears for expired activities
- ✅ Renewal dialog opens with correct data
- ✅ Invoice created successfully on renewal
- ✅ New activity period added to member
- ✅ Old activity period preserved (history)
- ✅ Renewal history tab working

### Credentials for Testing:
- **Admin**: username: `admin`, password: `admin123`
- **Test Member**: كرم (has expired activity for testing renewal)

### Next Priority Tasks:
1. **WhatsApp Business API Integration (P1)**: يحتاج Access Token و Phone Number ID من Meta Business Suite
2. **Code Refactoring (P0)**: تقسيم `server.py` و `InvoicesPage.js` و `AccountingPage.js` لتحسين الصيانة
3. **Activity Timetable Management (P2)**: جدول الأنشطة وإدارة المواعيد
4. **Attendance Tracking (P2)**: نظام تتبع الحضور

---

## Update 16 - Internal Expenses Module (February 3, 2026)

### New Feature: وحدة المصروفات الداخلية (النثرية) ✅

تم تنفيذ وحدة كاملة لإدارة المصروفات الداخلية والنثرية خارج نظام المحاسبة الرسمي مع إمكانية تحويلها لقيود محاسبية.

#### الميزات المنفذة:

##### 1. تبويب المصروفات الداخلية ✅
- **الوصف**: تبويب جديد "المصروفات الداخلية" في صفحة المحاسبة
- **الموقع**: `/app/frontend/src/pages/AccountingPage.js`
- **الأيقونة**: 💸

##### 2. بطاقات ملخصة ✅
- **عدد المصروفات**: إجمالي المصروفات المسجلة
- **إجمالي المصروفات**: المبلغ الكلي بالريال
- **قيد المراجعة**: عدد المصروفات المعلقة
- **جاهز للترحيل**: مبلغ المصروفات المعتمدة

##### 3. فلاتر البحث ✅
- فلترة بالتاريخ (من/إلى)
- فلترة بنوع المصروف
- فلترة بالحالة
- زر مسح الفلاتر

##### 4. إضافة مصروف جديد ✅
- **التاريخ**: تاريخ الصرف
- **نوع المصروف**: (نثرية، مواصلات، مستلزمات، صيانة، مرافق، طعام وضيافة، اتصالات، أخرى)
- **الوصف**: وصف المصروف
- **المبلغ**: المبلغ بالريال
- **طريقة الدفع**: (نقدي، بطاقة، تحويل)
- **اسم المنفذ**: من قام بالصرف
- **مركز التكلفة**: القسم أو الفرع
- **صورة الإيصال**: رفع صورة المرفق
- **ملاحظات**: ملاحظات إضافية

##### 5. إدارة حالات المصروفات ✅
- **قيد المراجعة (pending)**: الحالة الافتراضية عند الإضافة
- **معتمد (approved)**: بعد موافقة المدير
- **مرفوض (rejected)**: عند رفض المصروف
- **مرحل (posted)**: بعد الترحيل للقيود المحاسبية

##### 6. الإجراءات المتاحة ✅
- **اعتماد**: تغيير الحالة لمعتمد
- **رفض**: تغيير الحالة لمرفوض
- **تعديل**: تعديل بيانات المصروف
- **حذف**: حذف المصروف
- **عرض المرفق**: فتح صورة الإيصال

##### 7. ترحيل للقيود المحاسبية ✅
- زر "ترحيل للقيود" يظهر عند وجود مصروفات معتمدة
- إنشاء قيد محاسبي تلقائي
- تحديث حالة المصروفات لـ "مرحل"

##### 8. التوزيع حسب النوع ✅
- عرض توزيع المصروفات حسب النوع
- عدد المصروفات والمبلغ لكل نوع

##### 9. تصدير Excel ✅
- زر تصدير المصروفات لملف Excel
- يشمل جميع البيانات والفلاتر المطبقة

### API Endpoints المنفذة:

```
GET    /api/internal-expenses           - جلب قائمة المصروفات
GET    /api/internal-expenses/summary   - جلب ملخص المصروفات
GET    /api/internal-expenses/types     - جلب أنواع المصروفات
POST   /api/internal-expenses           - إضافة مصروف (with FormData for file upload)
PUT    /api/internal-expenses/{id}      - تعديل مصروف
PUT    /api/internal-expenses/{id}/status - تغيير حالة المصروف
POST   /api/internal-expenses/post-to-accounting - ترحيل للقيود
DELETE /api/internal-expenses/{id}      - حذف مصروف
GET    /api/export/internal-expenses    - تصدير Excel
```

### الملفات المعدلة:

1. **Frontend**:
   - `/app/frontend/src/pages/AccountingPage.js`: 
     - إضافة `fetchInternalExpenses`, `fetchExpensesSummary`, `fetchExpenseTypes`
     - إضافة `renderInternalExpensesTab` function
     - إضافة Dialog لإضافة/تعديل المصروفات
     - إضافة معالجات الحالات والترحيل
   - `/app/frontend/src/services/api.js`:
     - كان موجود مسبقاً: `internalExpensesAPI` object

2. **Backend**:
   - `/app/backend/server.py`: كان موجود مسبقاً (Lines 3840-4330)
   - `/app/backend/uploads/expenses/`: مجلد تخزين صور الإيصالات

### نتائج الاختبار (100% نجاح):
- ✅ تبويب المصروفات الداخلية يظهر ويعمل
- ✅ إضافة مصروف جديد مع جميع الحقول
- ✅ التحقق من صحة البيانات
- ✅ اعتماد/رفض المصروفات
- ✅ تعديل المصروفات
- ✅ البطاقات الملخصة تتحدث تلقائياً
- ✅ التوزيع حسب النوع يعمل
- ✅ زر الترحيل للقيود يظهر للمصروفات المعتمدة

### ملاحظات تقنية:
- استخدام `FormData` لرفع الملفات مع البيانات
- الصور تُخزن في `/app/backend/uploads/expenses/`
- يتم خدمة الصور عبر FastAPI Static Files

---

## المهام القادمة (أولوية محدثة):

### P0 - حرج (التالي):
1. **إعادة هيكلة الكود**: 
   - تقسيم `server.py` لـ routers منفصلة
   - تقسيم `AccountingPage.js` و `InvoicesPage.js` لمكونات أصغر

### P1 - أولوية عالية:
2. **WhatsApp Business API**: يحتاج Access Token و Phone Number ID

### P2 - أولوية متوسطة:
3. **صلاحيات متقدمة للمستخدمين**

---

## Update 18 - Activity Schedule/Timetable (February 5, 2026)

### New Feature: جدول الأنشطة والمواعيد ✅

تم تنفيذ صفحة لعرض جدول المواعيد الأسبوعي للأنشطة، مستخرج من بيانات الفواتير.

#### الميزات المنفذة:

##### 1. صفحة الجدول الجديدة ✅
- **المسار**: `/schedule`
- **رابط القائمة**: "الجدول" مع أيقونة CalendarDays

##### 2. العرض الأسبوعي ✅
- جدول 7 أيام (الأحد إلى السبت)
- عدد الحصص لكل يوم
- بطاقات الأنشطة بألوان مميزة
- عرض وقت الحصة (إن وُجد)

##### 3. عرض القائمة ✅
- قائمة المواعيد حسب النشاط
- نص الموعيد الكامل من الفاتورة
- عدد المشتركين في كل موعد

##### 4. الفلاتر ✅
- فلترة بالفرع
- فلترة بالنشاط
- إحصائيات (عدد الأنشطة، عدد الحصص)

##### 5. استخراج ذكي للمواعيد ✅
- قراءة نص الموعيد من الفاتورة (حقل schedule)
- تحليل الأيام (الأحد، الاثنين، إلخ)
- استخراج الوقت (الساعة 4، 5:00، إلخ)
- دمج المواعيد المتشابهة

### API Endpoints المنفذة:

```
GET /api/schedules              - جلب كل المواعيد
GET /api/schedules/weekly       - جدول أسبوعي منظم
GET /api/schedules/by-activity/{id} - مواعيد نشاط محدد
```

### الملفات الجديدة/المعدلة:

1. **Frontend**:
   - `/app/frontend/src/pages/SchedulePage.js` - صفحة جديدة
   - `/app/frontend/src/services/api.js` - إضافة `schedulesAPI`
   - `/app/frontend/src/App.js` - إضافة route
   - `/app/frontend/src/components/Layout.js` - إضافة رابط القائمة
   - `/app/frontend/src/contexts/LanguageContext.js` - إضافة ترجمة

2. **Backend**:
   - `/app/backend/server.py` - إضافة ~150 سطر (Schedule endpoints)

### ملاحظة تقنية:
- الجدول يستخرج المواعيد من حقل `schedule` في الفواتير
- يتم تحليل نص الموعيد لاستخراج الأيام والأوقات

---

## Update 19.1 - Schedule Page Redesign (February 5, 2026)

### التحسين: إعادة تصميم جدول المواعيد ✅

تم إعادة تصميم صفحة الجدول لتعرض الأنشطة كبطاقات ملونة منظمة حسب الأيام والأوقات.

#### التصميم الجديد:

##### 1. هيكل الجدول ✅
- **7 أعمدة** لأيام الأسبوع (الأحد → السبت)
- **header أسود** مع عدد الحصص لكل يوم
- **خلفية رمادية** لكل عمود

##### 2. بطاقات الأنشطة الملونة ✅
- **🏊 سباحة** - أزرق
- **⚽ كرة قدم** - أخضر
- **🥋 كاراتيه** - أحمر
- **🤸 جمباز** - بنفسجي
- **🎾 تنس** - أصفر
- **أخرى** - رمادي

##### 3. محتوى كل بطاقة ✅
- **Header ملون**: اسم النشاط + أيقونة
- **قائمة الأوقات**: كل وقت في صندوق منفصل مع أيقونة ساعة
- **Hover effect**: للانتقال لصفحة الحضور

##### 4. تجميع الأنشطة ✅
- يتم تجميع الحصص حسب النشاط في كل يوم
- عرض جميع الأوقات المتاحة داخل بطاقة واحدة

##### 5. دليل الألوان ✅
- قسم أسفل الجدول يوضح ألوان الأنشطة

### الملفات المعدلة:

- `/app/frontend/src/pages/SchedulePage.js` - إعادة كتابة كاملة

---

## Update 19.3 - Quick Attendance from Schedule (February 5, 2026)

### التحسين: تسجيل الحضور السريع من الجدول ✅

تم إضافة إمكانية تسجيل الحضور مباشرة من جدول المواعيد.

#### الميزات المضافة:

##### 1. فلتر التاريخ ✅
- حقل تاريخ في أعلى الصفحة
- التاريخ الافتراضي: اليوم
- يُستخدم عند تسجيل الحضور

##### 2. تسجيل الحضور بالضغط على الاسم ✅
- الضغط على اسم أي عضو يفتح نافذة
- النافذة تحتوي:
  - أيقونة دائرية بالحرف الأول
  - اسم العضو ورقم الجوال
  - اسم النشاط والتاريخ
  - زر **حاضر** (أخضر)
  - زر **غائب** (أحمر)
  - زر إلغاء

##### 3. حفظ في قاعدة البيانات ✅
- يتم حفظ السجل في collection `attendance`
- رسالة تأكيد بعد التسجيل
- الربط بالتاريخ المحدد في الفلتر

##### 4. تحسينات الواجهة ✅
- hover effect على أسماء الأعضاء
- أيقونة ✓ تظهر عند المرور
- tooltip "انقر لتسجيل الحضور"

### الملفات المعدلة:

- `/app/frontend/src/pages/SchedulePage.js`:
  - إضافة فلتر التاريخ
  - إضافة Dialog لتسجيل الحضور
  - إضافة دالة `openAttendanceDialog`
  - إضافة دالة `recordAttendance`

---

## Update 19.2 - Schedule with Members View (February 5, 2026)

### التحسين: عرض الأعضاء داخل الجدول ✅

تم إعادة تصميم جدول المواعيد ليعرض الأنشطة → الأوقات → الأعضاء.

#### التصميم الجديد:

##### 1. بطاقة لكل نشاط ✅
- **Header ملون** باسم النشاط وأيقونة
- عدد المشتركين وعدد الأوقات
- زر "تسجيل الحضور"
- قابلة للطي/الفتح

##### 2. داخل كل بطاقة - تقسيم حسب الوقت ✅
- عنوان الوقت (4:00، 5:00، بدون وقت محدد)
- عدد المشتركين لكل وقت

##### 3. داخل كل وقت - تقسيم حسب اليوم ✅
- بطاقات صغيرة لكل يوم
- عرض الأعضاء مع:
  - أيقونة دائرية بالحرف الأول
  - اسم العضو
  - رقم الجوال

##### 4. فلتر الأيام ✅
- تبويبات: الكل، الأحد، الإثنين... السبت
- فلترة ديناميكية للبيانات

##### 5. ألوان الأنشطة ✅
- 🏊 سباحة - أزرق
- ⚽ كرة قدم - أخضر
- 🥋 كاراتيه - أحمر
- 🤸 جمباز - بنفسجي
- أخرى - رمادي

### API الجديد:

```
GET /api/schedules/activities-with-members
```

يعيد هيكل البيانات:
```json
[{
  "activity_id": "...",
  "activity_name": "السباحة",
  "times": {
    "4:00": {
      "sunday": [{ "member_id", "member_name", "phone" }],
      "monday": [...],
      ...
    }
  }
}]
```

### الملفات المعدلة:

- `/app/backend/server.py` - إضافة endpoint جديد
- `/app/frontend/src/services/api.js` - إضافة `getActivitiesWithMembers`
- `/app/frontend/src/pages/SchedulePage.js` - إعادة كتابة كاملة

---

## Update 19 - Schedule-Attendance Integration (February 5, 2026)

### New Feature: ربط الجدول بنظام الحضور ✅

تم ربط جدول المواعيد بنظام الحضور للوصول السريع.

#### الميزات المنفذة:

##### 1. حصص اليوم في صفحة الحضور ✅
- عرض حصص اليوم الحالي تلقائياً
- أزرار للانتقال السريع لتسجيل الحضور
- عرض وقت الحصة مع كل زر

##### 2. الانتقال من الجدول للحضور ✅
- **في العرض الأسبوعي**: النقر على أي حصة ينتقل لصفحة الحضور
- **في عرض القائمة**: زر "تسجيل الحضور" لكل نشاط
- يتم تمرير `activity_id` عبر URL parameter

##### 3. التحميل التلقائي ✅
- عند الانتقال من الجدول، يتم اختيار النشاط تلقائياً
- يمكن الضغط على "تحميل القائمة" لعرض الأعضاء

### الملفات المعدلة:

1. **Frontend**:
   - `/app/frontend/src/pages/AttendancePage.js`:
     - إضافة `todaySessions` state
     - إضافة `fetchTodaySessions()` function
     - إضافة قسم "حصص اليوم" في الواجهة
     - قراءة `activity_id` من URL parameters
   - `/app/frontend/src/pages/SchedulePage.js`:
     - إضافة `goToAttendance()` function
     - إضافة `onClick` على بطاقات الحصص
     - إضافة زر "تسجيل الحضور" في عرض القائمة

---

## Update 20 - Attendance Stats in Member Card (February 5, 2026)

### New Feature: إحصائيات الحضور في كرت العضو ✅

تم ربط نظام الحضور بكرت العضو لعرض إحصائيات الحضور والغياب تلقائياً.

#### الميزات المنفذة:

##### 1. تبويب جديد "الحضور" في كرت العضو ✅
- يظهر في نافذة عرض تفاصيل العضو
- Badge أحمر يعرض عدد مرات الغياب

##### 2. بطاقات الإحصائيات ✅
- **إجمالي السجلات**: عدد سجلات الحضور الكلي
- **حضور**: عدد مرات الحضور (أخضر)
- **غياب**: عدد مرات الغياب (أحمر)
- **نسبة الحضور**: النسبة المئوية (بنفسجي)

##### 3. آخر السجلات ✅
- قائمة بآخر 20 سجل حضور
- عرض التاريخ والوقت والنشاط
- تمييز بالألوان (أخضر للحضور، أحمر للغياب)

### الملفات المعدلة:

- `/app/frontend/src/pages/MembersPage.js`:
  - إضافة import لـ `attendanceAPI`
  - إضافة `memberAttendance` state
  - تحديث `openViewDialog` لجلب بيانات الحضور
  - إضافة تبويب "الحضور" مع badge
  - إضافة محتوى تبويب الحضور مع الإحصائيات والسجلات

---

## Update 17 - Attendance Tracking System (February 4, 2026)

### New Feature: نظام تتبع الحضور ✅

تم تنفيذ نظام كامل لتتبع حضور الأعضاء في الأنشطة مع دعم التسجيل اليدوي وQR.

#### الميزات المنفذة:

##### 1. صفحة الحضور الجديدة ✅
- **المسار**: `/attendance`
- **رابط القائمة**: "الحضور" مع أيقونة ClipboardList

##### 2. تبويب تسجيل الحضور ✅
- اختيار الفرع والنشاط والتاريخ
- تحميل قائمة الأعضاء المسجلين في النشاط
- أزرار "حاضر" و "غائب" لكل عضو
- أزرار "الكل حاضر" و "الكل غائب"
- حفظ الحضور دفعة واحدة
- عرض ملخص (عدد الحاضرين/الغائبين)
- علامة "مسجل" للحضور المحفوظ مسبقاً

##### 3. تبويب تسجيل سريع QR ✅
- اختيار النشاط وإدخال رقم العضوية
- تسجيل الحضور بضغطة زر واحدة
- إنشاء رمز QR للنشاط للمسح
- عرض نتيجة التسجيل

##### 4. تبويب التقارير ✅
- فلترة بالنشاط والتواريخ
- إحصائيات ملخصة (إجمالي، حضور، غياب، نسبة)
- إحصائيات الأعضاء (نسبة حضور كل عضو)
- إحصائيات يومية
- تصدير Excel

##### 5. تصدير Excel ✅
- تصدير سجلات الحضور مع الفلاتر

### API Endpoints المنفذة:

```
GET    /api/attendance                              - جلب سجلات الحضور
GET    /api/attendance/by-activity/{id}?date=...   - حضور نشاط بتاريخ محدد
POST   /api/attendance                              - تسجيل حضور فردي
POST   /api/attendance/bulk                         - تسجيل حضور جماعي
POST   /api/attendance/qr-checkin                   - تسجيل سريع عبر QR
GET    /api/attendance/member/{id}/report          - تقرير حضور عضو
GET    /api/attendance/activity/{id}/report        - تقرير حضور نشاط
DELETE /api/attendance/{id}                         - حذف سجل
GET    /api/export/attendance                       - تصدير Excel
```

### الملفات الجديدة/المعدلة:

1. **Frontend**:
   - `/app/frontend/src/pages/AttendancePage.js` - صفحة جديدة كاملة
   - `/app/frontend/src/services/api.js` - إضافة `attendanceAPI`
   - `/app/frontend/src/App.js` - إضافة route
   - `/app/frontend/src/components/Layout.js` - إضافة رابط القائمة
   - `/app/frontend/src/contexts/LanguageContext.js` - إضافة ترجمة

2. **Backend**:
   - `/app/backend/server.py` - إضافة ~400 سطر (Attendance system)

### نتائج الاختبار (100% نجاح):
- Backend: 11/11 tests passed
- Frontend: 19/19 tests passed

### Bugs Fixed During Testing:
1. **أسماء الأنشطة**: تم تصحيح لعرض `name_ar` بدلاً من `name`
2. **حلقة لا نهائية (Critical)**: تم إصلاح useEffect dependencies

### ملاحظات تقنية:
- استخدام `qrcode.react` لإنشاء QR codes
- Bulk attendance API لحفظ الحضور دفعة واحدة
- تخزين الحضور في collection `attendance`



---

## Update 17 - Schedule Filtering by Date (February 5, 2026)

### New Features Added:

#### 1. Schedule Date Filtering ✅
- **Execute Button**: يقوم بتصفية الجدول حسب يوم الأسبوع للتاريخ المحدد
- **Day Detection**: يحدد تلقائياً يوم الأسبوع من التاريخ المدخل
- **UI Update**: يتم تحديث التبويب النشط ليطابق اليوم المحدد

### How It Works:
1. المستخدم يختار تاريخاً (مثلاً 2025-01-06)
2. يضغط على زر "تنفيذ"
3. النظام يحدد أن هذا التاريخ هو يوم الإثنين
4. يتم تصفية الجدول ليعرض فقط بيانات يوم الإثنين
5. يتم تحديد تبويب "الإثنين" تلقائياً

### Technical Implementation:
- Added `getDayOfWeek()` function to convert date string to day key
- Added `handleExecute()` function to set selected day and refresh data
- Updated "تنفيذ" button to call `handleExecute()` instead of `fetchActivities()`

### Files Modified:
- `/app/frontend/src/pages/SchedulePage.js` - Added filtering logic

### Testing Status: ✅ PASSED
- Manual testing confirmed working correctly
- Date 2025-01-06 correctly filters to Monday
- UI updates properly with selected day tab




---

## Update 18 - Simplified Schedule View (February 5, 2026)

### Changes Made:

#### 1. Removed Day Tabs ✅
- إزالة تبويبات الأيام (الأحد، الإثنين، إلخ)
- الجدول الآن يعرض بيانات اليوم المحدد فقط حسب التاريخ

#### 2. Auto Day Detection ✅
- يتم تحديد يوم الأسبوع تلقائياً من التاريخ المختار
- مثال: عند اختيار 08/01/2025 يتم تحديد "الأربعاء" تلقائياً

#### 3. Day Display Box ✅
- إضافة مربع يعرض اسم اليوم المحدد بجانب التاريخ
- يتحدث تلقائياً عند تغيير التاريخ

#### 4. Improved Members Grid ✅
- عرض الأعضاء في شبكة واضحة (5 أعمدة على الشاشات الكبيرة)
- بطاقات أكبر وأوضح لكل عضو
- رسالة "لا يوجد مشتركين في هذا اليوم" عند عدم وجود بيانات

### Technical Changes:
- `selectedDay` is now computed from `selectedDate` using `getDayOfWeek()`
- Removed day tabs UI component
- Updated stats to show only activities with members for selected day
- Simplified `getTotalMembers()` and `countMembersForTime()` functions

### Files Modified:
- `/app/frontend/src/pages/SchedulePage.js`

### Testing Status: ✅ PASSED
- Day detection working correctly
- Members filtered by day
- Empty state message displays properly


