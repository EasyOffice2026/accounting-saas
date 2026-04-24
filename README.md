# Mudawwarah Restaurant Management System

A full-stack restaurant management system for Mudawwarah, a Kuwaiti restaurant chain with multiple branches.

## Features

- **Dashboard**: Overview of sales, purchases, expenses, and employee count
- **Sales**: Dual-entry (Foodics POS vs Physical) with variance tracking, support for Cash, KNET, Link, WAMD, Talabat, Keeta, Jahez channels
- **Purchases**: Supplier management, purchase orders with line items, delivery order tracking
- **Expenses**: Categorized expense tracking with attachments
- **Human Resources**: Employee management with civil ID, position, salary tracking
- **Attendance**: Daily check-in/check-out tracking with status (present/absent/late/leave)
- **Dual Language**: English and Arabic (RTL) support
- **Branch-wise Login**: Owner sees all data, staff see only their branch

## Tech Stack

- **Backend**: Python FastAPI + SQLAlchemy + SQLite
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + i18next
- **Auth**: JWT-based authentication

## Setup

### Backend
```bash
cd backend
pip install fastapi uvicorn sqlalchemy "python-jose[cryptography]" "passlib[bcrypt]" python-multipart aiofiles pydantic pydantic-settings bcrypt==4.0.1
python -m uvicorn app.main:app --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Login Credentials

- **Owner** (all branches): `owner` / `owner123`
- **Branch Staff**: `al_aqeelah` / `staff123`, `al_aradiya` / `staff123`, `al_jahra` / `staff123`, `al_ayoun` / `staff123`

## Branches

- Al Aqeelah (العقيلة)
- Al Aradiya (العارضية)
- Al Jahra (الجهراء)
- Al Ayoun (العيون)
- Central Kitchen (المطبخ المركزي)
