from datetime import date

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.branch import Branch
from app.models.pos import PosBranchMapping, PosPaymentMapping
from app.models.user import User
from app.utils.auth import get_current_user
from app.utils import pos_sso
from app.utils.pos_sync import (
    CHANNELS, PosError, client_for, get_settings, guess_channel, is_configured, request_sync,
    signature_ok, sync, webhook_secret,
)

router = APIRouter(prefix="/api/pos", tags=["pos"])
ADMIN_ROLES = ("owner", "manager", "accountant")


def _admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Only owner, manager or accountant")
    return user


def _truthy(v: str | None) -> bool:
    return str(v).lower() in ("1", "true", "yes", "on")


def _pos_call(fn):
    try:
        return fn()
    except PosError as e:
        raise HTTPException(400, str(e))


@router.get("/settings")
def read_settings(request: Request, db: Session = Depends(get_db), _=Depends(_admin)):
    s = get_settings(db)
    issuer = pos_sso.issuer_for(str(request.base_url))
    return {
        "api_url": s.api_url or "", "web_url": s.web_url or "", "has_key": bool(s.api_key),
        "auto_sync": bool(s.auto_sync), "import_receipts": bool(s.import_receipts),
        "last_sync_at": s.last_sync_at.isoformat() + "Z" if s.last_sync_at else None,
        "last_error": s.last_error,
        "sso": {"issuer": issuer, "jwks_url": f"{issuer}/api/pos/sso/jwks.json", "audience": pos_sso.AUDIENCE},
        "webhook": {"url": f"{issuer}/api/pos/webhook", "secret": webhook_secret(db, s)},
        "channels": CHANNELS,
    }


@router.post("/settings")
def save_settings(
    api_url: str = Form(""), web_url: str = Form(""), api_key: str = Form(""),
    auto_sync: str = Form("true"), import_receipts: str = Form("true"),
    db: Session = Depends(get_db), _=Depends(_admin),
):
    s = get_settings(db)
    s.api_url = api_url.strip().rstrip("/") or None
    s.web_url = web_url.strip().rstrip("/") or None
    if api_key.strip():
        s.api_key = api_key.strip()
    s.auto_sync = _truthy(auto_sync)
    s.import_receipts = _truthy(import_receipts)
    db.commit()
    return {"status": "ok"}


def _structure(db: Session) -> dict:
    data = client_for(get_settings(db)).structure()
    branches, methods = [], {}
    for brand in data.get("brands", []):
        brand_name = (brand.get("name") or {}).get("en", "")
        for b in brand.get("branches", []):
            branches.append({"id": b["id"], "name": b.get("name") or {}, "brand": brand_name,
                             "is_active": b.get("isActive", True)})
        for m in brand.get("paymentMethods", []):
            methods.setdefault(m["key"], {"key": m["key"], "name": m.get("name") or {}})
    return {"branches": branches, "methods": list(methods.values())}


@router.post("/test")
def test_connection(db: Session = Depends(get_db), _=Depends(_admin)):
    st = _pos_call(lambda: _structure(db))
    return {"status": "ok", "branches": len(st["branches"]), "methods": len(st["methods"])}


@router.get("/structure")
def structure(db: Session = Depends(get_db), _=Depends(_admin)):
    return _pos_call(lambda: _structure(db))


@router.get("/branch-mappings")
def list_branch_mappings(db: Session = Depends(get_db), _=Depends(_admin)):
    return [{"pos_branch_id": m.pos_branch_id, "pos_branch_name": m.pos_branch_name,
             "local_branch_id": m.local_branch_id} for m in db.query(PosBranchMapping).all()]


@router.post("/branch-mappings")
def save_branch_mapping(
    pos_branch_id: str = Form(...), pos_branch_name: str = Form(""), local_branch_id: str = Form(""),
    db: Session = Depends(get_db), _=Depends(_admin),
):
    m = db.query(PosBranchMapping).filter(PosBranchMapping.pos_branch_id == pos_branch_id).first()
    if not local_branch_id:
        if m:
            db.delete(m)
            db.commit()
        return {"status": "ok"}
    if not db.get(Branch, int(local_branch_id)):
        raise HTTPException(404, "Branch not found")
    if not m:
        m = PosBranchMapping(pos_branch_id=pos_branch_id)
        db.add(m)
    m.pos_branch_name = pos_branch_name
    m.local_branch_id = int(local_branch_id)
    db.commit()
    return {"status": "ok"}


@router.get("/payment-mappings")
def list_payment_mappings(db: Session = Depends(get_db), _=Depends(_admin)):
    return [{"pos_method": m.pos_method, "pos_method_name": m.pos_method_name,
             "local_channel": m.local_channel} for m in db.query(PosPaymentMapping).all()]


def _save_method(db: Session, key: str, name: str, channel: str):
    m = db.query(PosPaymentMapping).filter(PosPaymentMapping.pos_method == key).first()
    if not channel:
        if m:
            db.delete(m)
        return
    if channel not in CHANNELS:
        raise HTTPException(400, "Unknown channel")
    if not m:
        m = PosPaymentMapping(pos_method=key)
        db.add(m)
    m.pos_method_name = name
    m.local_channel = channel


@router.post("/payment-mappings")
def save_payment_mapping(
    pos_method: str = Form(...), pos_method_name: str = Form(""), local_channel: str = Form(""),
    db: Session = Depends(get_db), _=Depends(_admin),
):
    _save_method(db, pos_method, pos_method_name, local_channel)
    db.commit()
    return {"status": "ok"}


@router.post("/auto-map-payments")
def auto_map_payments(db: Session = Depends(get_db), _=Depends(_admin)):
    methods = _pos_call(lambda: _structure(db))["methods"]
    existing = {m.pos_method for m in db.query(PosPaymentMapping).all()}
    mapped = 0
    for m in methods:
        if m["key"] in existing:
            continue
        channel = guess_channel(m["key"], m["name"].get("en", ""))
        if channel:
            _save_method(db, m["key"], m["name"].get("en", m["key"]), channel)
            mapped += 1
    db.commit()
    return {"mapped": mapped, "total": len(methods)}


@router.post("/sync")
def sync_now(
    date_from: str = Form(...), date_to: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(_admin),
):
    try:
        d_from = date.fromisoformat(date_from)
        d_to = date.fromisoformat(date_to) if date_to else d_from
    except ValueError:
        raise HTTPException(400, "Invalid date")
    return _pos_call(lambda: {"status": "ok", **sync(db, d_from, d_to, user.id)})


@router.get("/sso/jwks.json")
def sso_jwks(db: Session = Depends(get_db)):
    return pos_sso.jwks(db, get_settings(db))


@router.post("/sso")
def sso(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = get_settings(db)
    if not (is_configured(s) and s.web_url):
        raise HTTPException(400, "The POS is not set up yet")
    if not user.email:
        raise HTTPException(400, "Your user has no POS email. Ask the owner to add it in Settings > Users.")
    t = pos_sso.ticket(db, s, pos_sso.issuer_for(str(request.base_url)), user.id, user.email)
    return {"url": f"{s.web_url}/sso#ticket={t}"}


@router.post("/webhook")
async def pos_webhook(request: Request, db: Session = Depends(get_db)):
    """The POS calls this after a payment, refund, void or goods receipt (no user session)."""
    body = await request.body()
    s = get_settings(db)
    if not signature_ok(s.webhook_secret, body, request.headers.get("x-pos-signature", "")):
        raise HTTPException(401, "Bad signature")
    if is_configured(s) and s.auto_sync:
        request_sync()
    return {"status": "queued"}
