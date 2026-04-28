# Champions Academy Management System

## Overview
This project is a comprehensive full-stack management system for Champions Academy (شركة اداء الابطال العالمية للرياضة), a sports academy. Its primary purpose is to streamline and automate various administrative and operational tasks. Key capabilities include managing members, generating invoices, tracking attendance, facilitating coaching activities, overseeing loyalty programs, and providing a dual-interface experience for both administrators and academy members. The vision is to provide an efficient, centralized platform that enhances the academy's operations, improves member engagement, and supports scalable growth in the sports education market.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Ask before making major changes.
Do not make changes to the folder `frontend/android/`.
Do not make changes to the file `frontend/capacitor.config.json`.

## System Architecture
The system employs a full-stack architecture with distinct components for the backend, frontend, and database.

**UI/UX Decisions:**
- **Dual-Interface Routing:** Separate interfaces for administrators (`/admin/*`) and members (`/` root) with dedicated dashboards.
- **Styling:** React frontend utilizes TailwindCSS for a consistent and responsive design.
- **Mobile Experience:** Capacitor integrates web assets into a native Android application. Push notifications via Firebase Cloud Messaging (FCM) for Android and Web Push for browsers.
- **Privacy Policy:** A public, bilingual privacy policy page is available at `/privacy`.
- **Customizable Dashboard:** Admins can personalize their dashboard by showing, hiding, and reordering widgets.
- **Grouped Sidebar Navigation:** The admin sidebar is organized into collapsible groups.
- **Printable Vouchers:** Payment vouchers are formatted for official printing with Arabic amounts and signature fields.

**Technical Implementations & Feature Specifications:**
- **Member Management:** Comprehensive CRUD operations for member profiles, including subscription details, attendance records, and communication. Members can self-service update parts of their profile and submit change requests for locked fields.
- **Invoicing:** Generation and management of invoices with PDF and Excel export capabilities. WhatsApp sharing of invoice images is supported.
- **Attendance Tracking:**
    - **Member Attendance:** QR code-based check-in with schedule validation, instant notifications, and session quota monitoring. Member photos are included in attendance reports (XLSX and PDF exports).
    - **Coach Attendance:** Tracking check-in/check-out times, work hours calculation, and monthly reports.
- **Activity & Training Management:** Management of training schedules, activities, and levels, with day-based navigation for level management. The primary scheduling tool is the **Levels Schedule Builder** (day tabs → hour groups → level cards) which writes `days[]` and a single `time_slot` per level. Auto-assignment matches members on **branch + day + hour** (activity is only an optional tiebreaker). The legacy per-level Cleanup Tool is still available as a fallback for one release.
- **Communication:** Internal messaging system for direct and broadcast messages, and push notifications for announcements and attendance.
- **Financial Management:**
    - **Daily Financial Ledger:** Tracks daily income, expenses, refunds, and net profit with export options.
    - **Internal Expense Payments:** Manages payments for internal expenses.
    - **Payment Vouchers:** Generates official vouchers for payments to individuals.
- **Loyalty Programs:** Customizable loyalty point settings.
- **Subscription Management:** Dedicated pages for renewals, day extensions (calculates extensions per training day), and member freeze/suspension with automatic end-date adjustments and activity logging.
- **Security:** JWT-based authentication for secure API access.
- **Branch Scoping:** Multi-branch isolation for non-admin users, ensuring data segregation based on `branch_id`.
- **Database Backup:** Functionality to create, list, download, restore, and delete database backups.
- **Global Search:** Unified search bar in the admin dashboard for members, invoices, and activities.
- **Advertisement Management:** Ad banner images stored persistently in MongoDB and served dynamically.
- **Social Publisher:** Cross-posting page for Facebook, Instagram, YouTube, and TikTok, allowing media uploads and caption overrides. OAuth credentials managed via settings panel. Supports design templates for posts. Includes insights history retention.

**System Design Choices:**
- **Backend Framework:** FastAPI (Python) for a high-performance, asynchronous web framework.
- **Frontend Framework:** React with Create React App (CRA) and `craco`, styled with TailwindCSS.
- **Deployment:** Gunicorn with UvicornWorker serving the FastAPI backend and the built React frontend.
- **Modularity:** Backend routes are modularized.
- **Lazy Loading:** Heavy imports are lazy-loaded to optimize startup.
- **CORS:** Enabled for all origins.
- **PWA Support:** Service Worker registration for Progressive Web App capabilities and push notifications.

## External Dependencies
- **Database:** MongoDB Atlas (NoSQL cloud database)
- **Mobile Development:** Capacitor (for Android mobile app bundling)
- **Push Notifications:** Firebase Cloud Messaging (FCM) for native Android, Firebase Admin SDK (backend).
- **Reporting & Export:** `reportlab` (for PDF generation), `openpyxl` (for Excel export).
- **QR Code Generation:** `qrcode` library.
- **Image Processing:** `html2canvas` (for WhatsApp invoice image sharing).