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
