# Champions Academy Management System

## Overview
This project is a comprehensive full-stack management system for Champions Academy (شركة اداء الابطال العالمية للرياضة), a sports academy. Its primary purpose is to streamline and automate various administrative and operational tasks. The system's key capabilities include managing members, generating invoices, tracking attendance, facilitating coaching activities, overseeing loyalty programs, and providing a dual-interface experience for both administrators and academy members. The vision is to provide an efficient, centralized platform that enhances the academy's operations, improves member engagement, and supports scalable growth in the sports education market.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Ask before making major changes.
Do not make changes to the folder `frontend/android/`.
Do not make changes to the file `frontend/capacitor.config.json`.

## System Architecture
The system employs a full-stack architecture with distinct components for the backend, frontend, and database.

**UI/UX Decisions:**
- **Dual-Interface Routing:** The system features separate interfaces for administrators (`/admin/*`) and members (`/` root).
  - **Admin Dashboard:** Provides comprehensive management tools for members, invoices, activities, etc.
  - **Member Area:** Offers personalized access to subscriptions, schedules, notifications, and loyalty points.
- **Styling:** React frontend utilizes TailwindCSS for a utility-first CSS approach, ensuring a consistent and responsive design.
- **Mobile Experience:** Capacitor (Android) integrates web assets into a native Android application, providing a mobile-friendly experience. Push notifications are implemented via Firebase Cloud Messaging (FCM) for native Android and Web Push for browsers.
- **Privacy Policy:** A public, bilingual privacy policy page is available at `/privacy`.
- **Customizable Dashboard:** Admins can personalize their dashboard by showing, hiding, and reordering widgets.
- **Grouped Sidebar Navigation:** The admin sidebar is organized into collapsible groups for improved usability.
- **Printable Vouchers:** Payment vouchers are formatted for official printing with Arabic words for amounts and signature fields.

**Technical Implementations & Feature Specifications:**
- **Member Management:** Comprehensive CRUD operations for member profiles, including subscription details, attendance records, and communication.
- **Invoicing:** Generation and management of invoices, with PDF and Excel export capabilities. WhatsApp sharing of invoice images is supported. InvoicesPage has been refactored: the original 6,615-line file is now split into 5 hooks (`useInvoiceForm`, `useViewInvoiceHandlers`, `useQRCardPrint`, `useMemberCardPrint`, `useRegFormState`) under `invoices/hooks/`, and 12 dialog components under `invoices/components/dialogs/`. The main `InvoicesPage.js` is now 531 lines (orchestrator only).
- **Attendance Tracking:**
    - **Member Attendance:** QR code-based check-in with schedule validation, instant notifications, and session quota monitoring.
    - **Coach Attendance:** Tracking check-in/check-out times, work hours calculation, and monthly reports.
- **Activity & Training Management:** Includes managing training schedules, activities, and levels, with day-based navigation for level management.
- **Communication:**
    - **Internal Messaging System:** Direct and broadcast messaging between admins and members.
    - **Push Notifications:** Supports both web and native Android push notifications for announcements and attendance.
- **Financial Management:**
    - **Daily Financial Ledger:** Tracks daily income, expenses, refunds, and net profit with category breakdowns and export options.
    - **Internal Expense Payments:** Manages payments for internal expenses, showing balances.
    - **Payment Vouchers:** Generates official vouchers for payments to individuals.
- **Loyalty Programs:** Customizable loyalty point settings with CRUD operations.
- **Subscription Management:**
    - **Renewals:** Dedicated page for managing subscription renewals.
    - **Day Extensions:** Manages closure periods and bulk/individual subscription extensions.
    - **Member Freeze/Suspension:** Allows temporary suspension of member subscriptions with automatic end-date extensions and activity logging.
- **Security:** JWT-based authentication for secure API access. Default admin user created on startup if no users exist.
- **Database Backup:** Functionality to create, list, download, restore, and delete database backups.
- **Global Search:** Unified search bar in the admin dashboard for members, invoices, and activities.
- **Advertisement Management:** Ad banner images are stored persistently in MongoDB and served dynamically.
- **Social Publisher:** Cross-posting page for Facebook, Instagram, YouTube, and TikTok. Admins (or users with the `social-publisher` permission) upload one image or video, write one caption (with optional per-platform overrides), pick the targets, and publish synchronously. Each platform is a separate adapter under `backend/utils/social/` (Meta covers FB+IG with one OAuth, YouTube uses Google OAuth + resumable upload, TikTok uses the Content Posting API's PULL_FROM_URL flow). Uploaded media is stored at `backend/uploads/social/<uuid>.<ext>` and served from the existing `/uploads/` mount; remote platforms fetch by URL. Tokens are stored in MongoDB collections `social_accounts`, `social_posts`, `social_post_targets` and are stripped before being returned to the frontend. OAuth callback URLs follow the pattern `https://<domain>/api/social/callback/{platform}`. Required environment secrets: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`. Frontend page: `frontend/src/pages/SocialPublisherPage.js`. Routes registered at `/admin/social-publisher`.

**System Design Choices:**
- **Backend Framework:** FastAPI (Python) provides a high-performance, asynchronous web framework.
- **Frontend Framework:** React with Create React App (CRA) and `craco` for customization, coupled with TailwindCSS for styling.
- **Deployment:** Gunicorn with UvicornWorker serves the FastAPI backend, which also serves the built React frontend from `backend/static/`.
- **Modularity:** Backend routes are modularized into separate files for better organization.
- **Lazy Loading:** Heavy imports are lazy-loaded to optimize application startup time.
- **CORS:** Enabled for all origins to facilitate development and integration.
- **PWA Support:** Service Worker registration is enabled for Progressive Web App capabilities and push notifications.

## External Dependencies
- **Database:** MongoDB Atlas (NoSQL cloud database)
- **Mobile Development:** Capacitor (for Android mobile app bundling)
- **Push Notifications:** Firebase Cloud Messaging (FCM) for native Android push notifications, Firebase Admin SDK (on backend)
- **Reporting & Export:**
    - `reportlab` (for PDF generation)
    - `openpyxl` (for Excel export)
- **QR Code Generation:** `qrcode` library
- **Image Processing:** `html2canvas` (for WhatsApp invoice image sharing)