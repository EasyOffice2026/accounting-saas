from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.database import Base, engine
from app.models import *  # noqa: F401,F403 — register all models
from app.utils.auth import hash_password
from app.routes import auth, branches, sales, purchases, expenses, hr, dashboard

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


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    _seed_data()


def _seed_data():
    from app.database import SessionLocal
    from app.models.branch import Branch
    from app.models.user import User
    from app.models.expense import ExpenseCategory

    db = SessionLocal()
    try:
        if db.query(Branch).count() > 0:
            return

        branch_data = [
            ("Al Aqeelah", "العقيلة", False),
            ("Al Aradiya", "العارضية", False),
            ("Al Jahra", "الجهراء", False),
            ("Al Ayoun", "العيون", False),
            ("Central Kitchen", "المطبخ المركزي", True),
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

        # Branch staff accounts
        for b in branches:
            if not b.is_central_kitchen:
                staff = User(
                    username=b.name.lower().replace(" ", "_"),
                    password_hash=hash_password("staff123"),
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
    finally:
        db.close()
