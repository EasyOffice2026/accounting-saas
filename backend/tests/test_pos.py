import base64
import json
from datetime import date

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import *  # noqa: F401,F403
from app.models.branch import Branch
from app.models.pos import PosBranchMapping, PosPaymentMapping, PosReceipt
from app.models.purchase import PurchaseOrder, Supplier
from app.models.sale import Sale
from app.utils import pos_sso
from app.utils.pos_sync import PosError, get_settings, sync


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add(Branch(id=1, name="Salmiya"))
    session.add(PosBranchMapping(pos_branch_id="b-1", pos_branch_name="Salmiya", local_branch_id=1))
    for key, channel in [("cash", "cash"), ("knet", "knet"), ("talabat", "talabat")]:
        session.add(PosPaymentMapping(pos_method=key, local_channel=channel))
    s = get_settings(session)
    s.api_url, s.api_key = "https://pos.test/api/v1", "posk_test"
    session.commit()
    yield session
    session.close()


def day(branch, when, payments, refunds=()):
    line = lambda m, a: {"method": m, "name": {"en": m, "ar": m}, "amount": a, "commission": "0.000"}
    return {"id": f"day:{branch}:{when}", "branchId": branch, "businessDate": when,
            "payments": [line(m, a) for m, a in payments], "refunds": [line(m, a) for m, a in refunds]}


def transport(days, receipts=(), seen=None):
    def handler(request: httpx.Request):
        assert request.headers["authorization"] == "Bearer posk_test"
        if seen is not None:
            seen.append(request.url.path)
        if request.url.path.endswith("/accounting/days"):
            return httpx.Response(200, json={"days": days})
        if request.url.path.endswith("/accounting/goods-receipts"):
            return httpx.Response(200, json={"receipts": list(receipts)})
        return httpx.Response(404)
    return httpx.MockTransport(handler)


def test_day_fills_system_figures_and_keeps_physical(db):
    db.add(Sale(branch_id=1, date=date(2026, 11, 20), physical_cash=99.5))
    db.commit()
    days = [day("b-1", "2026-11-20", [("cash", "100.250"), ("knet", "50.125"), ("talabat", "20.000")],
                [("knet", "5.000")]),
            day("b-9", "2026-11-20", [("cash", "1.000")]),
            day("b-1", "2026-11-21", [("applepay", "3.000")])]
    r = sync(db, date(2026, 11, 20), date(2026, 11, 21), transport=transport(days))
    assert r["days_updated"] == 1 and r["days_created"] == 1
    assert r["unmapped_branches"] == ["b-9"] and r["unmapped_methods"] == ["applepay"]
    s = db.query(Sale).filter(Sale.date == date(2026, 11, 20)).one()
    assert (s.foodics_cash, s.foodics_knet, s.foodics_talabat, s.cancelled_knet) == (100.25, 50.125, 20.0, 5.0)
    assert s.physical_cash == 99.5
    assert get_settings(db).last_sync_at is not None


def test_resync_replaces_figures_and_clears_vanished_days(db):
    sync(db, date(2026, 11, 20), date(2026, 11, 20),
         transport=transport([day("b-1", "2026-11-20", [("cash", "10.000")])]))
    sync(db, date(2026, 11, 20), date(2026, 11, 20), transport=transport([]))
    s = db.query(Sale).one()
    assert s.foodics_cash == 0


def test_goods_receipt_becomes_one_cash_purchase(db):
    receipt = {"id": "grn:po-1", "number": 7, "branchId": "b-1", "businessDate": "2026-11-20",
               "invoiceNumber": "INV-9", "total": "42.500", "supplier": {"id": "s", "name": "Al Mawashi"}}
    for _ in range(2):
        sync(db, date(2026, 11, 20), date(2026, 11, 20), transport=transport([], [receipt]))
    po = db.query(PurchaseOrder).one()
    assert (po.branch_id, po.payment_type, po.total_amount, po.status) == (1, "cash", 42.5, "received")
    assert db.query(Supplier).one().name == "Al Mawashi"
    assert db.query(PosReceipt).count() == 1


def test_receipts_skipped_when_turned_off(db):
    get_settings(db).import_receipts = False
    db.commit()
    seen = []
    sync(db, date(2026, 11, 20), date(2026, 11, 20), transport=transport([], seen=seen))
    assert seen == ["/api/v1/accounting/days"]


def test_long_range_is_split_into_31_day_calls(db):
    seen = []
    sync(db, date(2026, 1, 1), date(2026, 3, 15), transport=transport([], seen=seen))
    assert seen.count("/api/v1/accounting/days") == 3


def test_refused_key_is_recorded(db):
    bad = httpx.MockTransport(lambda r: httpx.Response(401))
    with pytest.raises(PosError):
        sync(db, date(2026, 11, 20), date(2026, 11, 20), transport=bad)
    assert "refused" in get_settings(db).last_error


def test_sso_ticket_verifies_with_published_key(db):
    s = get_settings(db)
    token = pos_sso.ticket(db, s, "https://mud.test", 5, "Owner@Example.com")
    head, body, sig = token.split(".")
    pad = lambda x: base64.urlsafe_b64decode(x + "=" * (-len(x) % 4))
    key = pos_sso.jwks(db, s)["keys"][0]
    Ed25519PublicKey.from_public_bytes(pad(key["x"])).verify(pad(sig), f"{head}.{body}".encode())
    claims = json.loads(pad(body))
    assert claims["email"] == "owner@example.com" and claims["aud"] == "pos" and claims["iss"] == "https://mud.test"
    assert claims["exp"] - claims["iat"] == 60 and json.loads(pad(head))["kid"] == key["kid"]


def test_clean_env_keeps_setup_and_drops_transactions(tmp_path):
    import subprocess, sqlite3, sys as _sys
    src = tmp_path / "live.db"
    engine = create_engine(f"sqlite:///{src}")
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Branch(id=1, name="Salmiya"))
    s.add(Supplier(name="Al Mawashi"))
    s.add(Sale(branch_id=1, date=date(2026, 11, 1), physical_cash=5))
    s.add(PurchaseOrder(branch_id=1, supplier_id=1, date=date(2026, 11, 1), total_amount=3))
    s.commit(); s.close(); engine.dispose()
    out = tmp_path / "clean.db"
    r = subprocess.run([_sys.executable, "scripts/make_clean_env.py", str(src), str(out)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    db2 = sqlite3.connect(out)
    count = lambda t: db2.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    assert (count("branches"), count("suppliers"), count("sales"), count("purchase_orders")) == (1, 1, 0, 0)
    assert sqlite3.connect(src).execute("SELECT COUNT(*) FROM sales").fetchone()[0] == 1


def test_webhook_signature_and_wakeup(db, monkeypatch):
    import asyncio, hashlib, hmac as _hmac
    from fastapi import HTTPException
    from app.routes import pos as pos_routes
    from app.utils import pos_sync
    s = pos_sync.get_settings(db)
    s.api_url, s.api_key, s.auto_sync = "https://pos.test/api/v1", "posk_x", True
    secret = pos_sync.webhook_secret(db, s)
    assert secret and pos_sync.webhook_secret(db, s) == secret
    woke = []
    monkeypatch.setattr(pos_routes, "request_sync", lambda: woke.append(1))
    body = b'{"event":"figures.changed"}'

    class Req:
        def __init__(self, sig):
            self.headers = {"x-pos-signature": sig}
        async def body(self):
            return body

    good = _hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert asyncio.run(pos_routes.pos_webhook(Req(good), db)) == {"status": "queued"}
    assert woke == [1]
    for bad in ("", "0" * 64):
        try:
            asyncio.run(pos_routes.pos_webhook(Req(bad), db))
            raise AssertionError("accepted a bad signature")
        except HTTPException as e:
            assert e.status_code == 401
    assert woke == [1]


def test_unit_types_split_sales_from_admin_units(db):
    from app.models.branch import Branch
    from app.routes.branches import list_branches
    from app.utils.units import infer_unit_type
    assert infer_unit_type("Al Jahra") == "sales"
    assert infer_unit_type("Purchase Office - Mudawwarah") == "purchase_office"
    assert infer_unit_type("HR Office - Khubuz Maraei") == "hr_office"
    assert infer_unit_type("Personnel Office - Mudawwarah") == "personnel_office"
    assert infer_unit_type("Administration") == "administration"
    assert infer_unit_type("Kitchen", True) == "central_kitchen"
    db.add_all([Branch(name="Shop A", unit_type="sales"), Branch(name="Store A", unit_type="central_store"),
                Branch(name="Office A", unit_type="purchase_office"), Branch(name="Admin A", unit_type="administration")])
    db.commit()
    names = lambda scope: sorted(b["name"] for b in list_branches(scope=scope, db=db))
    mine = {"Shop A", "Store A", "Office A", "Admin A"}
    names_mine = lambda scope: sorted(set(names(scope)) & mine)
    assert names_mine("sales") == ["Shop A"]
    assert names_mine("stock") == ["Shop A", "Store A"]
    assert names_mine("purchase") == ["Office A"]
    assert "Office A" not in names("operating") and "Admin A" in names("operating")


def test_central_receipt_goes_into_pos_stock_and_usage_leaves_inventory(db):
    from app.models.hr import Brand
    from app.models.pos import PosStockLink, PosStockPush
    from app.models.procurement import ProcOrder, ProcOrderItem
    from app.models.purchase import SupplierItem
    from app.utils import pos_stock
    from app.utils.ledger import Ledger, build_entries, ensure_chart

    db.add(Brand(id=1, name_en="Mudawwarah"))
    db.get(Branch, 1).brand_id = 1
    db.add(Branch(id=2, name="Central Store - Mudawwarah", brand_id=1, unit_type="central_store"))
    db.add(PosBranchMapping(pos_branch_id="store-1", pos_branch_name="Store", local_branch_id=2))
    db.add(Supplier(id=1, name="Mills"))
    db.add(SupplierItem(id=5, supplier_id=1, item_name="Flour 10kg", unit_price=3))
    db.add(PosStockLink(brand_id=1, source="supplier_item", item_id=5, pos_ingredient_id="ing-flour", factor=10))
    db.add(ProcOrder(id=1, po_no="PO-1", brand_id=1, supplier_id=1, date=date(2026, 11, 19)))
    db.add(ProcOrderItem(order_id=1, supplier_item_id=5, item_name="Flour 10kg", quantity=2, unit_price=3, received_qty=2))
    db.commit()

    assert pos_stock.queue_central_receipt(db, db.get(ProcOrder, 1))
    db.commit()
    assert not pos_stock.queue_central_receipt(db, db.get(ProcOrder, 1))
    body = json.loads(db.query(PosStockPush).one().payload)
    assert (body["branchId"], body["kind"]) == ("store-1", "received")
    assert body["lines"] == [{"ingredientId": "ing-flour", "quantity": "20.000", "unitCost": "0.300"}]

    posted = []

    class Client:
        def post(self, path, payload):
            posted.append((path, payload["key"]))
            return {}

    assert pos_stock.push_pending(db, Client()) == {"stock_posted": 1, "stock_failed": 0}
    assert posted == [("/accounting/stock", "central_receipt:1")]

    when = date(2026, 11, 20)
    pos_stock.apply_costs(db, [
        {"branchId": "b-1", "businessDate": when.isoformat(), "ingredientId": "ing-flour", "kind": "sold", "cost": "1.500"},
        {"branchId": "b-1", "businessDate": when.isoformat(), "ingredientId": "ing-flour", "kind": "waste", "cost": "0.250"},
    ], when, when)
    get_settings(db).inventory_accounting = True
    db.commit()
    ensure_chart(db)
    L = Ledger(db)
    [entry] = [e for e in build_entries(db, L, when) if e.source == "pos_stock"]
    code_of = {acc: code for (_, code), acc in L.by_code.items()}
    lines = sorted((code_of[ln[0]], round(ln[2], 3), round(ln[3], 3)) for ln in entry.lines)
    assert lines == [("1310", 0, 0.25), ("1310", 0, 1.5), ("5110", 1.5, 0), ("5140", 0.25, 0)]
