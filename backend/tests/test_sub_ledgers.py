from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import *  # noqa: F401,F403
from app.models.accounting import AccAccount, AccJournal, AccJournalLine
from app.models.branch import Branch
from app.models.expense import Expense, ExpenseCategory
from app.models.hr import Brand
from app.models.sale import Sale
from app.routes.accounting import income_statement_data, ledger_data, trial_balance_data
from app.utils.ledger import sync_ledger
from app.utils.ledger_access import get_settings


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Brand(id=1, name_en="Mudawwarah"))
    s.add(Branch(id=3, name="Al Jahra", name_ar="الجهراء", brand_id=1, unit_type="sales"))
    s.add(Branch(id=6, name="Administration", brand_id=1, unit_type="administration"))
    s.add(ExpenseCategory(id=1, name="Rent", name_ar="إيجار"))
    s.commit()
    get_settings(s).start_date = date(2026, 11, 1)
    s.commit()
    return s


def balances(db):
    out = {}
    for line, acc in db.query(AccJournalLine, AccAccount).join(AccAccount, AccAccount.id == AccJournalLine.account_id)\
            .join(AccJournal, AccJournal.id == AccJournalLine.journal_id).filter(AccJournal.is_active.is_(True)).all():
        out[(acc.code, acc.name)] = round(out.get((acc.code, acc.name), 0) + line.debit - line.credit, 3)
    return out


def test_sales_by_branch_and_method_and_expense_heads_by_unit(db):
    db.add(Sale(branch_id=3, date=date(2026, 11, 5), physical_cash=10, physical_knet=4, physical_talabat=6))
    db.add(Expense(branch_id=6, cost_branch_id=3, category_id=1, amount=300, date=date(2026, 11, 5), payment_method="cash",
                   description="Al Jahra rent"))
    db.add(Expense(branch_id=6, category_id=1, amount=50, date=date(2026, 11, 5), payment_method="cash", description="Office rent"))
    db.commit()
    sync_ledger(db)
    b = balances(db)
    assert b[("4100-03-01", "Sales - Al Jahra - Cash")] == -10
    assert b[("4100-03-02", "Sales - Al Jahra - KNET")] == -4
    assert b[("4100-03-05", "Sales - Al Jahra - Talabat")] == -6
    assert b[("1210-03", "KNET receivable - Al Jahra")] == 4
    assert b[("1230-03", "Talabat receivable - Al Jahra")] == 6
    assert b[("6210.1-03", "Rent - Al Jahra")] == 300
    assert b[("6210.1-06", "Rent - Administration")] == 50
    assert b[("1110-06", "Cash box - Administration")] == -350
    head = db.query(AccAccount).filter(AccAccount.code == "4100-03").one()
    assert head.is_header and head.name_ar == "المبيعات - الجهراء"

    led = ledger_data(db, head.id, None, None, None)
    assert led["closing"] == 20 and len(led["rows"]) == 3

    tb = trial_balance_data(db, 1, None, None, None, detail=False)
    assert tb["balanced"] and {r["code"] for r in tb["rows"]} >= {"4100", "6210.1", "1210", "1230"}
    jahra = income_statement_data(db, 1, None, None, 3)
    assert (jahra["total_revenue"], jahra["operating_expenses"]) == (20, 300)
    detail = income_statement_data(db, 1, None, None, None, detail=True)
    opex = [a["code"] for g in detail["expenses"] for a in g["accounts"]]
    assert opex == ["6210.1-03", "6210.1-06"]
