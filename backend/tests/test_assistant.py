import json
from datetime import date

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import *  # noqa: F401,F403
from app.models.assistant import AssistantLog
from app.models.branch import Branch
from app.models.expense import Expense, ExpenseCategory
from app.models.hr import Brand
from app.models.procurement import ProcOrder, ProcOrderItem
from app.models.purchase import PurchaseItem, PurchaseOrder, Supplier
from app.models.sale import Sale
from app.models.user import User
from app.utils import assistant


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Brand(id=1, name_en="Mudawwarah"), Brand(id=2, name_en="Khubuz Maraei")])
    s.add_all([Branch(id=1, name="Al Jahra", brand_id=1, unit_type="sales"),
               Branch(id=2, name="Al Ayoun", brand_id=1, unit_type="sales"),
               Branch(id=3, name="Administration", brand_id=1, unit_type="administration"),
               Branch(id=4, name="Ahmadi Branch", brand_id=2, unit_type="sales")])
    s.add_all([User(id=1, username="owner", password_hash="x", full_name="Owner", role="owner"),
               User(id=2, username="jahra", password_hash="x", full_name="Jahra", role="staff", branch_id=1),
               User(id=3, username="hr", password_hash="x", full_name="HR", role="hr_officer")])
    s.add(Supplier(id=1, name="Almarai"))
    s.add(ExpenseCategory(id=1, name="Rent", name_ar="إيجار"))
    s.add(ExpenseCategory(id=2, name="Utilities"))
    s.add_all([Sale(branch_id=1, date=date(2026, 10, 5), physical_cash=10, physical_knet=5, foodics_cash=10, foodics_knet=5.5),
               Sale(branch_id=1, date=date(2026, 10, 6), physical_talabat=7.25, foodics_talabat=7.25),
               Sale(branch_id=2, date=date(2026, 10, 6), physical_cash=4),
               Sale(branch_id=1, date=date(2026, 11, 1), physical_cash=100)])
    s.add_all([Expense(branch_id=1, category_id=1, date=date(2026, 10, 1), description="Oct rent", amount=850),
               Expense(branch_id=3, category_id=1, date=date(2026, 10, 1), description="Office rent", amount=300),
               Expense(branch_id=2, category_id=2, date=date(2026, 10, 3), description="Electricity", amount=40)])
    s.add(PurchaseOrder(id=1, branch_id=1, supplier_id=1, date=date(2026, 10, 2), total_amount=6))
    s.add(PurchaseItem(purchase_order_id=1, item_name="Fresh Milk 1L", quantity=12, unit="pcs", unit_price=0.5, total=6))
    s.add(ProcOrder(id=1, po_no="PO-1", brand_id=1, supplier_id=1, date=date(2026, 10, 9), status="received"))
    s.add(ProcOrderItem(order_id=1, item_name="Milk powder", item_name_ar="حليب", unit="pcs", quantity=10,
                        received_qty=8, unit_price=2, total=20, received_total=16))
    s.add(ProcOrder(id=2, po_no="PO-2", brand_id=1, supplier_id=1, date=date(2026, 10, 9), status="approved"))
    s.add(ProcOrderItem(order_id=2, item_name="Milk powder", unit="pcs", quantity=50, unit_price=2, total=100))
    s.commit()
    yield s
    s.close()


def user(db, uid):
    return db.get(User, uid)


def test_sales_last_month_for_a_branch(db):
    scope = assistant.Scope(db, user(db, 1))
    r, f = assistant.run_report(db, scope, "sales_report", {"date_from": "2026-10-01", "date_to": "2026-10-31", "branch_ids": [1]})
    assert r["total_physical_sales"] == 22.25 and r["total_pos_system_sales"] == 22.75
    assert f["branches"] == ["Al Jahra"]


def test_sales_default_to_sales_branches_and_group_by_channel(db):
    scope = assistant.Scope(db, user(db, 1))
    r, f = assistant.run_report(db, scope, "sales_report", {"date_from": "2026-10-01", "date_to": "2026-10-31", "brand_id": 1, "group_by": "channel"})
    assert f["branches"] == ["Al Jahra", "Al Ayoun"]
    assert {x["group"]: x["physical_sales"] for x in r["rows"]} == {"cash": 14.0, "knet": 5.0, "talabat": 7.25}


def test_rent_for_restaurants_only(db):
    scope = assistant.Scope(db, user(db, 1))
    r, _ = assistant.run_report(db, scope, "expense_report", {"date_from": "2026-10-01", "date_to": "2026-10-31",
                                                             "category_ids": [1], "restaurants_only": True})
    assert r["total"] == 850.0
    r, f = assistant.run_report(db, scope, "expense_report", {"date_from": "2026-10-01", "date_to": "2026-10-31", "category_ids": [1]})
    assert r["total"] == 1150.0 and f["categories"] == ["Rent"]


def test_milk_bought_counts_branch_and_received_central_purchases(db):
    scope = assistant.Scope(db, user(db, 1))
    r, _ = assistant.run_report(db, scope, "purchase_report", {"date_from": "2026-10-01", "date_to": "2026-10-31", "item": "milk"})
    rows = {x["group"]: (x["quantity"], x["amount"]) for x in r["rows"]}
    assert rows == {"Fresh Milk 1L": (12.0, 6.0), "Milk powder": (8.0, 16.0)}
    assert r["total_amount"] == 22.0


def test_branch_login_only_sees_its_branch(db):
    scope = assistant.Scope(db, user(db, 2))
    r, f = assistant.run_report(db, scope, "sales_report", {"date_from": "2026-10-01", "date_to": "2026-10-31"})
    assert f["branches"] == ["Al Jahra"] and r["total_physical_sales"] == 22.25
    with pytest.raises(assistant.NotAllowed):
        assistant.run_report(db, scope, "sales_report", {"date_from": "2026-10-01", "date_to": "2026-10-31", "branch_ids": [2]})
    r, f = assistant.run_report(db, scope, "purchase_report", {"date_from": "2026-10-01", "date_to": "2026-10-31", "item": "milk"})
    assert r["total_amount"] == 6.0 and "Central purchases" not in f["branches"]
    assert "stock_report" not in scope.reports


def test_office_roles_cannot_use_it(db):
    with pytest.raises(assistant.NotAllowed):
        assistant.Scope(db, user(db, 3))


def test_ask_runs_the_report_the_model_picks_and_logs_it(db):
    calls = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            assert "Al Jahra" in body["messages"][0]["content"]
            return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "sales_report", "arguments": json.dumps(
                    {"date_from": "2026-10-01", "date_to": "2026-10-31", "branch_ids": [1]})}}]}}]})
        tool = json.loads(body["messages"][-1]["content"])
        assert tool["total_physical_sales"] == 22.25
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "Al Jahra sold 22.250 KWD in October."}}]})

    out = assistant.ask(db, user(db, 1), "What were Al Jahra's sales last month?", transport=httpx.MockTransport(handler))
    assert out["answer"] == "Al Jahra sold 22.250 KWD in October."
    assert out["reports"][0]["filters"]["branches"] == ["Al Jahra"]
    log = db.query(AssistantLog).one()
    assert log.user_id == 1 and log.answer == out["answer"] and "sales_report" in log.reports


def test_a_refused_report_is_told_to_the_model_not_run(db):
    seen = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        if len(seen) == 0:
            seen.append(1)
            return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "sales_report", "arguments": json.dumps(
                    {"date_from": "2026-10-01", "date_to": "2026-10-31", "branch_ids": [2]})}}]}}]})
        assert "not available" in json.loads(body["messages"][-1]["content"])["error"]
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "You can only see Al Jahra."}}]})

    out = assistant.ask(db, user(db, 2), "Al Ayoun sales?", transport=httpx.MockTransport(handler))
    assert out["reports"] == []
