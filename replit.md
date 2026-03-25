# Champions Academy Management System

## Overview
A full-stack management system for Champions Academy (شركة اداء الابطال العالمية للرياضة) - a sports academy. The system handles member management, invoicing, attendance tracking, coaching, activities, loyalty programs, and more.

## Architecture
- **Backend**: FastAPI (Python) served via Gunicorn + UvicornWorker
- **Frontend**: React (CRA with craco) + TailwindCSS, built to production and served from `backend/static/`
- **Database**: MongoDB Atlas (external)
- **Mobile**: Capacitor (Android) - web assets bundled for Android APK
- **Port**: 5000 (backend serves everything)
- **Production Server**: Gunicorn with uvicorn.workers.UvicornWorker (binds port immediately for health checks)
- **Entry Point**: backend/main.py imports server:app, Gunicorn wraps it
- **Heavy imports** (reportlab, openpyxl, qrcode) are lazy-loaded via helper functions to speed up startup

## Dual-Interface Routing
- **Admin Dashboard**: `/admin/*` - accessible only by admin users
  - Login at `/login`
  - Dashboard at `/admin/dashboard`
  - All management pages under `/admin/` (members, invoices, activities, etc.)
- **Member Area**: `/` (root) - accessible by regular members
  - Member login at `/member-login`
  - Member dashboard at `/`
  - Member pages: `/subscriptions`, `/member-schedule`, `/card`, `/notifications`, `/videos`, `/loyalty-points`, etc.
- **Privacy Policy**: `/privacy` - public bilingual page

## Project Structure
```
backend/
  server.py          - Main FastAPI app with all routes
  database.py        - MongoDB connection config
  routes/            - Modular route files (users, members, invoices, etc.)
  static/            - Built React frontend (production build)
  uploads/           - File uploads directory
frontend/
  src/               - React source code
  src/pages/         - Admin pages + member-portal/ subdirectory
  android/           - Capacitor Android project
  capacitor.config.json - Capacitor configuration
  package.json       - Node.js dependencies (craco, tailwind, react, capacitor)
  craco.config.js    - CRA override config
```

## Key Configuration
- Frontend is built with `npx craco build` in frontend/ then copied to backend/static/
- Backend serves static files via FastAPI's StaticFiles mount + catch-all route
- MongoDB connection uses `tlsAllowInvalidCertificates=True` due to SSL environment constraints
- CORS enabled for all origins
- Default admin user: admin / 123456 (auto-created on startup if no users exist)
- Capacitor app ID: com.championsacademy.app

## Build Commands
- **Frontend build**: `cd frontend && GENERATE_SOURCEMAP=false npx craco build`
- **Copy to backend**: `cp -r frontend/build/* backend/static/`
- **Capacitor sync**: `cd frontend && npx cap sync android`
- **Android build**: Open `frontend/android/` in Android Studio to build APK

## Environment Variables
- `MONGO_URL` - MongoDB Atlas connection string (secret)
- `DB_NAME` - MongoDB database name
- `JWT_SECRET_KEY` - JWT signing secret
- `FIREBASE_SERVICE_ACCOUNT` - Firebase Admin SDK service account JSON (for FCM push notifications)

## Recent Changes
- Added Training Schedule Reminders - TrainingReminder component on member dashboard shows today's sessions with attendance status, backend parses schedule text for day/time matching (sources: member.activities + invoices)
- Added Instant Attendance Notifications - AttendanceToast component polls for new attendance notifications every 30 seconds, backend creates notifications in member_notifications collection on all attendance recording operations (single/bulk/QR)
- Added attendance notification section to MemberNotifications page with bilingual support
- Restructured routing: admin pages under /admin/*, member portal at root /
- Added role-based redirect (admin -> /admin/dashboard, member -> /)
- Added Privacy Policy page at /privacy (bilingual Arabic/English)
- Added Capacitor for Android mobile build
- Added Renewals management page (/admin/renewals)
- Added Database Backup page (/admin/backup) - create, list, download, restore, delete backups
- Added PDF & Excel export for Members and Invoices pages
- Fixed MongoDB SSL connection parameters
- Re-enabled Service Worker registration for PWA + Push Notifications support
- Added Push Notification system: service worker push/click handlers, PushNotificationManager component on member dashboard + daily videos, admin broadcast page (/admin/push-notifications)
- Backend push notification routes: subscribe, unsubscribe, subscription-status, broadcast, subscribers-count
- Mobile UI improvements: safe-area padding, responsive touch targets, smooth transitions
- QR Attendance Schedule Validation: auto-checks member's scheduled days before recording attendance. Correct day → auto check-in with success. Wrong day → warning with scheduled days shown + manual override button. Uses Saudi timezone (UTC+3) for day comparison. Schedule parsed from invoice items.
- Internal Messaging System: Admin-member direct messaging within the app. Admin can send to individual members or broadcast to all. Members can view and reply from /member-messages. Unread badges in navigation. Backend routes in backend/routes/messages.py + member_portal.py. Frontend: "Internal Messages" tab in MessagesPage + MemberMessages page. MongoDB collection: messages.
- Global Search: Unified search bar in admin header (Ctrl+K shortcut) searches across members, invoices, and activities simultaneously. Backend endpoint /api/global-search with regex matching. Results shown in categorized dropdown with navigation links. Component: frontend/src/components/GlobalSearch.js
- Customizable Dashboard: Admin can show/hide and reorder dashboard widgets (Statistics Cards, Detail View, Expiring Subscriptions, Recent Notes). Settings saved per-user in MongoDB dashboard_settings collection. Customize button opens panel with up/down arrows and visibility toggles. Backend endpoints: GET/PUT /api/dashboard/settings

- Grouped Sidebar Navigation: Admin sidebar reorganized from 20+ flat items into 7 collapsible groups (Main, Members, Activities & Training, Finance, Communication, More, Administration) with smooth CSS accordion animations. Active page auto-expands its group. Permission filtering preserved per group.

- Daily Financial Ledger (اليومية المالية): Full daily financial tracking at /admin/daily-ledger. Features: daily summary (income/expenses/refunds/net profit), manual expense CRUD with categories (rent, salaries, maintenance, purchases, utilities, marketing, equipment, transportation, other), monthly calendar view with daily financial summaries, daily comparison (today vs yesterday vs same day last week), income by payment method breakdown, expenses by category breakdown, transaction search/filter, CSV/PDF export, password protection (242456). Backend: routes/daily_ledger.py with MongoDB expenses collection. Sidebar: under Finance group.

- Day Extensions (ترحيل الأيام): Manage closures (holidays/maintenance/emergencies) and extend member subscriptions at /admin/day-extensions. Features: create closure periods with date ranges and reason types, bulk apply extensions to all active members (with optional branch filter), manual individual member extensions, extension activity log tracking all operations. Backend: routes/day_extensions.py with MongoDB closures and extension_logs collections. Admin-only access with input validation. Sidebar: under Finance group.

- Session Quota Monitoring (مراقبة الحصص): Tracks member session usage vs allowed quota based on subscription days per week from invoice schedule. Calculates total allowed sessions = weeks × days_per_week. Backend: check_member_session_quota() in attendance.py, endpoints GET /api/attendance/session-quota/{member_id} and GET /api/attendance/session-quota-alerts. QR check-in shows warning when member has ≤2 sessions remaining or has exceeded quota (amber alert with used/total/remaining counts). Member detail dialog shows session quota progress bars in attendance tab. Product-member linkage: product invoices support optional member_id, Store page has member search in invoice form, Members page has Purchases tab.

- Member Freeze/Suspension (تجميد العضوية): Admins can temporarily freeze member subscriptions from the Members page. Features: freeze with date range and reason (travel/medical/personal/other), auto-extend subscription end dates by freeze duration, block attendance check-in during freeze, cancel freeze with rollback, 30-day annual limit per member, freeze stats (days used/remaining), freeze history log. Backend: routes/freezes.py with MongoDB member_freezes collection. Endpoints: POST /api/freezes, POST /api/freezes/{id}/cancel, GET /api/freezes/member/{id}, GET /api/freezes/active, GET /api/freezes/member/{id}/stats. Frontend: Snowflake button per member + freeze tab in member detail dialog. Notifications sent to member on freeze/unfreeze.

- Coach Attendance (حضور المدربين): Track coach check-in/check-out times at /admin/coach-attendance. Features: daily attendance view with check-in/check-out buttons, mark absent/leave with reason, auto-calculate work hours, edit records manually, monthly report with attendance summary per coach, CSV export. Backend: routes/coach_attendance.py with MongoDB coach_attendance collection. Sidebar: under Activities & Training group. Uses Saudi timezone (UTC+3).

- Native Android Push Notifications (إشعارات أندرويد): Firebase Cloud Messaging (FCM) integration for native Android push notifications via Capacitor. Hybrid system: Web Push (VAPID) for browser users + FCM for Android app users. Firebase project: champions-academy-229ce. Backend detects subscription platform (web/android) and sends via appropriate channel. PushNotificationManager component auto-detects native vs web environment. Files: google-services.json in android/app/, firebase-admin SDK on backend, @capacitor/push-notifications on frontend.
  - v1.0.9 (build 10): Fixed FCM notification delivery: removed `click_action="FCM_PLUGIN_ACTIVITY"` (Cordova-only, broke Capacitor), changed `channel_id` from "champions_notifications" to "default" (Capacitor's auto-created channel). Added auto-registration on startup: if permission already granted, silently re-registers FCM token (fixes broken tokens after reinstall). Web assets synced to Android project via cap copy.

- WhatsApp Invoice Image Sharing: WhatsApp share button captures invoice as PNG image using html2canvas, shares via Web Share API on mobile or downloads image + opens WhatsApp on desktop. Fallback to text-only message on error.

- Levels Day-Based Navigation: Levels page (/admin/levels) now starts with a weekday selection screen (Saturday-Friday). After selecting a day, activities/times/levels are shown with members filtered by their invoice schedule. Backend returns member schedule info from member activities or latest paid invoice. Frontend filters members using Arabic day name matching against schedule strings. Stats (player counts, fill percentages) update per selected day.

- Loyalty Points Settings CRUD: Admin can add custom point items, edit values, and delete any point setting from the Settings tab in /admin/loyalty. Backend accepts dynamic keys (not fixed schema) and handles deletion via $unset. Custom labels stored as key-value pairs in MongoDB loyalty_settings collection.

- Performance Optimizations: `/api/levels` batch queries (2.23s → 0.17s, 13× faster), MembersPage lazy-loads levels data only when add/edit dialog opens (initial page load no longer waits for levels), auto-cleanup of expired level subscriptions removed from GET request to avoid slowdown. Post-merge setup script at `scripts/post-merge.sh` auto-rebuilds frontend only when `frontend/src` changes.

- Advertisement Image Persistence: Ad banner images now stored in MongoDB (`ad_images` collection) in addition to disk. New dynamic route `GET /api/uploads/ads/{filename}` serves from disk first, falls back to MongoDB if file is missing (e.g. after server restart), and writes back to disk for future requests. Startup migration auto-backs-up any existing disk images to MongoDB. Removed static `app.mount("/api/uploads", ...)` in favor of this dynamic route.

## Known Issues
- MongoDB Atlas SSL handshake may fail with `TLSV1_ALERT_INTERNAL_ERROR` - this is typically caused by the Replit IP not being whitelisted in MongoDB Atlas Network Access settings. The user needs to add `0.0.0.0/0` (allow all) in MongoDB Atlas Network Access.
