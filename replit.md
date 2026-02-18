# Champions Academy Management System

## Overview
A full-stack management system for Champions Academy (شركة اداء الابطال العالمية للرياضة) - a sports academy. The system handles member management, invoicing, attendance tracking, coaching, activities, loyalty programs, and more.

## Architecture
- **Backend**: FastAPI (Python) serving both API and frontend static files
- **Frontend**: React (CRA with craco) + TailwindCSS, built to production and served from `backend/static/`
- **Database**: MongoDB Atlas (external)
- **Mobile**: Capacitor (Android) - web assets bundled for Android APK
- **Port**: 5000 (backend serves everything)

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

## Recent Changes
- Restructured routing: admin pages under /admin/*, member portal at root /
- Added role-based redirect (admin -> /admin/dashboard, member -> /)
- Added Privacy Policy page at /privacy (bilingual Arabic/English)
- Added Capacitor for Android mobile build
- Added Renewals management page (/admin/renewals)
- Added Database Backup page (/admin/backup) - create, list, download, restore, delete backups
- Added PDF & Excel export for Members and Invoices pages
- Fixed MongoDB SSL connection parameters
- Removed Service Worker for cache management

## Known Issues
- MongoDB Atlas SSL handshake may fail with `TLSV1_ALERT_INTERNAL_ERROR` - this is typically caused by the Replit IP not being whitelisted in MongoDB Atlas Network Access settings. The user needs to add `0.0.0.0/0` (allow all) in MongoDB Atlas Network Access.
