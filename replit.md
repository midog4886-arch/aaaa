# Champions Academy Management System

## Overview
A full-stack management system for Champions Academy (شركة اداء الابطال العالمية للرياضة) - a sports academy. The system handles member management, invoicing, attendance tracking, coaching, activities, loyalty programs, and more.

## Architecture
- **Backend**: FastAPI (Python) serving both API and frontend static files
- **Frontend**: React (CRA with craco) + TailwindCSS, built to production and served from `backend/static/`
- **Database**: MongoDB Atlas (external)
- **Port**: 5000 (backend serves everything)

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
  package.json       - Node.js dependencies (craco, tailwind, react)
  craco.config.js    - CRA override config
```

## Key Configuration
- Frontend is built with `npm run build` in frontend/ then copied to backend/static/
- Backend serves static files via FastAPI's StaticFiles mount + catch-all route
- MongoDB connection uses `tlsAllowInvalidCertificates=True` due to SSL environment constraints
- CORS enabled for all origins
- Default admin user: admin / 123456 (auto-created on startup if no users exist)

## Environment Variables
- `MONGO_URL` - MongoDB Atlas connection string (secret)
- `DB_NAME` - MongoDB database name
- `JWT_SECRET_KEY` - JWT signing secret

## Recent Changes
- Configured FastAPI to serve React frontend at root `/` route
- Fixed MongoDB SSL connection parameters
- Built frontend for production (GENERATE_SOURCEMAP=false)
- Set up workflow to run on port 5000

## Known Issues
- MongoDB Atlas SSL handshake may fail with `TLSV1_ALERT_INTERNAL_ERROR` - this is typically caused by the Replit IP not being whitelisted in MongoDB Atlas Network Access settings. The user needs to add `0.0.0.0/0` (allow all) in MongoDB Atlas Network Access.
