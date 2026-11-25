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
