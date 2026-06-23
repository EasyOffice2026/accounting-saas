from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from app.database import Base, engine
from app.models import *  # noqa: F401,F403 — register all models
from app.utils.auth import hash_password
from app.routes import auth, branches, sales, purchases, expenses, hr, dashboard
from app.routes import cash, items, export, email, payment, transfers, whatsapp, users
from app.routes import foodics

app = FastAPI(title="Mudawwarah Restaurant Management System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount uploads
upload_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")

# Include routes
app.include_router(auth.router)
app.include_router(branches.router)
app.include_router(sales.router)
app.include_router(purchases.router)
app.include_router(expenses.router)
app.include_router(hr.router)
app.include_router(dashboard.router)
app.include_router(cash.router)
app.include_router(items.router)
app.include_router(export.router)
app.include_router(email.router)
app.include_router(payment.router)
app.include_router(transfers.router)
app.include_router(whatsapp.router)
app.include_router(users.router)
app.include_router(foodics.router)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


# Serve frontend static files
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static_frontend")
if not os.path.isdir(FRONTEND_DIST):
    FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "frontend", "dist")
FRONTEND_DIST = os.path.abspath(FRONTEND_DIST)

if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="frontend-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    _migrate_columns()
    _seed_data()


def _migrate_columns():
    """Add missing columns to existing tables (lightweight migration)."""
    from sqlalchemy import text, inspect
    with engine.connect() as conn:
        insp = inspect(engine)
        # Add api_url to whatsapp_settings if missing
        if "whatsapp_settings" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("whatsapp_settings")]
            if "api_url" not in cols:
                conn.execute(text("ALTER TABLE whatsapp_settings ADD COLUMN api_url TEXT"))
                conn.commit()

        # Purchase orders: add missing columns
        if "purchase_orders" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("purchase_orders")]
            if "delivery_location" not in cols:
                conn.execute(text("ALTER TABLE purchase_orders ADD COLUMN delivery_location TEXT"))
            if "category_id" not in cols:
                conn.execute(text("ALTER TABLE purchase_orders ADD COLUMN category_id INTEGER"))
            conn.commit()

        # Supplier items: add missing columns
        if "supplier_items" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("supplier_items")]
            if "category_id" not in cols:
                conn.execute(text("ALTER TABLE supplier_items ADD COLUMN category_id INTEGER"))
            if "item_name_ar" not in cols:
                conn.execute(text("ALTER TABLE supplier_items ADD COLUMN item_name_ar TEXT"))
            if "packaging" not in cols:
                conn.execute(text("ALTER TABLE supplier_items ADD COLUMN packaging TEXT"))
            conn.commit()

        # Expenses: add missing columns
        if "expenses" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("expenses")]
            if "supplier_id" not in cols:
                conn.execute(text("ALTER TABLE expenses ADD COLUMN supplier_id INTEGER"))
            if "category_id" not in cols:
                conn.execute(text("ALTER TABLE expenses ADD COLUMN category_id INTEGER"))
            conn.commit()

        # Employees: add new fields
        if "employees" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("employees")]
            for col in ["staff_no", "iban", "bank_name", "salary_transfer_method", "employer"]:
                if col not in cols:
                    default = " DEFAULT 'cash'" if col == "salary_transfer_method" else " DEFAULT 'mudawwarah'" if col == "employer" else ""
                    conn.execute(text(f"ALTER TABLE employees ADD COLUMN {col} TEXT{default}"))
            if "termination_date" not in cols:
                conn.execute(text("ALTER TABLE employees ADD COLUMN termination_date DATE"))
            for sal_col in ["work_permit_salary", "actual_salary"]:
                if sal_col not in cols:
                    conn.execute(text(f"ALTER TABLE employees ADD COLUMN {sal_col} FLOAT DEFAULT 0"))
            for date_col in ["last_working_date", "residency_expiry", "health_card_expiry"]:
                if date_col not in cols:
                    conn.execute(text(f"ALTER TABLE employees ADD COLUMN {date_col} DATE"))
            conn.commit()

        # Salary payments: add new fields
        if "salary_payments" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("salary_payments")]
            float_cols = [
                "housing_allowance", "transport_allowance", "food_allowance",
                "other_allowance", "allowances", "absence_deduction",
                "late_deduction", "other_deduction", "deductions", "advance",
                "overtime", "bonus", "incentive", "leave_salary",
                "ticket_payment", "loan_deduction", "penalty",
            ]
            for col in float_cols:
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE salary_payments ADD COLUMN {col} REAL DEFAULT 0"))
            for col in ["period_start", "period_end"]:
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE salary_payments ADD COLUMN {col} DATE"))
            if "last_workplace" not in cols:
                conn.execute(text("ALTER TABLE salary_payments ADD COLUMN last_workplace TEXT"))
            for int_col in ["total_days", "days_worked"]:
                if int_col not in cols:
                    conn.execute(text(f"ALTER TABLE salary_payments ADD COLUMN {int_col} INTEGER DEFAULT 30"))
            conn.commit()

        # Advance loans: add deduction_month
        if "advance_loans" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("advance_loans")]
            if "deduction_month" not in cols:
                conn.execute(text("ALTER TABLE advance_loans ADD COLUMN deduction_month TEXT"))
                conn.commit()

        # Resignation table - add dues_cleared_consent columns
        if "resignations" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("resignations")]
            if "dues_cleared_consent" not in cols:
                conn.execute(text("ALTER TABLE resignations ADD COLUMN dues_cleared_consent BOOLEAN DEFAULT FALSE"))
            if "consent_date" not in cols:
                conn.execute(text("ALTER TABLE resignations ADD COLUMN consent_date DATE"))
            if "other_earnings" not in cols:
                conn.execute(text("ALTER TABLE resignations ADD COLUMN other_earnings FLOAT DEFAULT 0"))
            if "other_deductions" not in cols:
                conn.execute(text("ALTER TABLE resignations ADD COLUMN other_deductions FLOAT DEFAULT 0"))
            conn.commit()

        # Brands table
        if "brands" not in insp.get_table_names():
            conn.execute(text("""
                CREATE TABLE brands (
                    id SERIAL PRIMARY KEY,
                    name_en TEXT NOT NULL,
                    name_ar TEXT,
                    status TEXT DEFAULT 'active',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()

        # Seed default brand and assign to existing branches/contracts
        from app.models.hr import Brand
        brand_count = conn.execute(text("SELECT COUNT(*) FROM brands")).scalar()
        if brand_count == 0:
            conn.execute(text("INSERT INTO brands (name_en, name_ar, status) VALUES ('Mudawwarah', 'مدوّرة', 'active')"))
            conn.commit()

        # Add brand_id to branches
        if "branches" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("branches")]
            if "brand_id" not in cols:
                conn.execute(text("ALTER TABLE branches ADD COLUMN brand_id INTEGER REFERENCES brands(id)"))
                # Assign all existing branches to brand 1 (Mudawwarah)
                conn.execute(text("UPDATE branches SET brand_id = 1 WHERE brand_id IS NULL"))
                conn.commit()

        # Contracts table
        if "contracts" not in insp.get_table_names():
            conn.execute(text("""
                CREATE TABLE contracts (
                    id SERIAL PRIMARY KEY,
                    brand_id INTEGER REFERENCES brands(id),
                    name TEXT NOT NULL,
                    kind TEXT,
                    place TEXT,
                    value FLOAT DEFAULT 0,
                    start_date DATE,
                    end_date DATE,
                    monthly_payment FLOAT DEFAULT 0,
                    payment_day INTEGER DEFAULT 1,
                    notes TEXT,
                    status TEXT DEFAULT 'active',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.commit()
        else:
            cols = [c["name"] for c in insp.get_columns("contracts")]
            if "brand_id" not in cols:
                conn.execute(text("ALTER TABLE contracts ADD COLUMN brand_id INTEGER REFERENCES brands(id)"))
                conn.execute(text("UPDATE contracts SET brand_id = 1 WHERE brand_id IS NULL"))
                conn.commit()


def _seed_data():
    from app.database import SessionLocal
    from app.models.branch import Branch
    from app.models.user import User
    from app.models.expense import ExpenseCategory

    db = SessionLocal()
    try:
        if db.query(Branch).count() > 0:
            # Add Administration branch if missing
            if not db.query(Branch).filter(Branch.name == "Administration").first():
                db.add(Branch(name="Administration", name_ar="الإدارة", is_central_kitchen=False))
                db.commit()
            return

        branch_data = [
            ("Al Aqeelah", "العقيلة", False),
            ("Al Aradiya", "العارضية", False),
            ("Al Jahra", "الجهراء", False),
            ("Al Ayoun", "العيون", False),
            ("Central Kitchen", "المطبخ المركزي", True),
            ("Administration", "الإدارة", False),
        ]
        branches = []
        for name, name_ar, is_ck in branch_data:
            b = Branch(name=name, name_ar=name_ar, is_central_kitchen=is_ck)
            db.add(b)
            branches.append(b)
        db.commit()

        # Owner account (all branches)
        owner = User(
            username="owner", password_hash=hash_password("owner123"),
            full_name="Owner", role="owner", branch_id=None,
        )
        db.add(owner)

        # Manager account (all branches)
        manager = User(
            username="manager", password_hash=hash_password("manager123"),
            full_name="Manager", role="manager", branch_id=None,
        )
        db.add(manager)

        # Branch staff accounts
        branch_usernames = {
            "Al Aqeelah": "aqeelah",
            "Al Aradiya": "aradiya",
            "Al Jahra": "jahra",
            "Al Ayoun": "ayoun",
            "Central Kitchen": "kitchen",
        }
        for b in branches:
            uname = branch_usernames.get(b.name, b.name.lower().replace(" ", "_"))
            pwd = f"{uname}123"
            staff = User(
                username=uname,
                password_hash=hash_password(pwd),
                full_name=f"{b.name} Staff", role="staff", branch_id=b.id,
            )
            db.add(staff)

        # Expense categories
        for name, name_ar in [
            ("Rent", "إيجار"), ("Utilities", "مرافق"), ("Salaries", "رواتب"),
            ("Maintenance", "صيانة"), ("Marketing", "تسويق"),
            ("Supplies", "مستلزمات"), ("Other", "أخرى"),
        ]:
            db.add(ExpenseCategory(name=name, name_ar=name_ar))

        db.commit()

        # Seed purchase categories
        _seed_purchase_categories(db)
    finally:
        db.close()

    # Also seed categories on existing DBs
    db2 = SessionLocal()
    try:
        _seed_purchase_categories(db2)
    finally:
        db2.close()


def _seed_purchase_categories(db):
    from app.models.purchase import PurchaseCategory
    if db.query(PurchaseCategory).count() > 0:
        return
    for name, name_ar in [
        ("Food Items", "مواد غذائية"),
        ("Packaging", "تغليف"),
        ("Consumables Items", "مواد استهلاكية"),
        ("Vegetables", "خضروات"),
    ]:
        db.add(PurchaseCategory(name=name, name_ar=name_ar))
    db.commit()
