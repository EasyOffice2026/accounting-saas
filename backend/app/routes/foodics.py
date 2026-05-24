from fastapi import APIRouter, Depends, HTTPException, Form
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date, datetime, timezone
import httpx
import asyncio

from app.database import get_db
from app.models.foodics import FoodicsSettings, FoodicsBranchMapping, FoodicsPaymentMapping
from app.models.sale import Sale
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/foodics", tags=["foodics"])

PAYMENT_CHANNEL_KEYWORDS = {
    "cash": "cash",
    "knet": "knet",
    "k-net": "knet",
    "link": "link",
    "visa": "link",
    "mastercard": "link",
    "credit": "link",
    "debit": "link",
    "card": "link",
    "wamd": "wamd",
}


def _get_settings(db: Session) -> FoodicsSettings | None:
    return db.query(FoodicsSettings).first()


def _require_settings(db: Session) -> FoodicsSettings:
    s = _get_settings(db)
    if not s or not s.api_token:
        raise HTTPException(status_code=400, detail="Foodics API token not configured")
    return s


def _headers(settings: FoodicsSettings) -> dict:
    return {
        "Authorization": f"Bearer {settings.api_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _base_url(settings: FoodicsSettings) -> str:
    if settings.is_sandbox:
        return "https://api-sandbox.foodics.com/v5"
    return settings.base_url or "https://api.foodics.com/v5"


# ── Settings ──────────────────────────────────────────────────

@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = _get_settings(db)
    if not s:
        return {
            "has_token": False,
            "base_url": "https://api.foodics.com/v5",
            "is_sandbox": False,
            "last_sync_at": None,
        }
    return {
        "has_token": bool(s.api_token),
        "base_url": s.base_url,
        "is_sandbox": s.is_sandbox,
        "last_sync_at": s.last_sync_at.isoformat() if s.last_sync_at else None,
    }


@router.post("/settings")
def save_settings(
    api_token: Optional[str] = Form(None),
    base_url: str = Form("https://api.foodics.com/v5"),
    is_sandbox: bool = Form(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Only owner/manager can configure Foodics")

    s = _get_settings(db)
    if not s:
        s = FoodicsSettings()
        db.add(s)

    if api_token:
        s.api_token = api_token
    s.base_url = base_url
    s.is_sandbox = is_sandbox
    db.commit()
    return {"status": "ok"}


# ── Test Connection ───────────────────────────────────────────

@router.post("/test")
async def test_connection(db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = _require_settings(db)
    url = f"{_base_url(s)}/whoami"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_headers(s))
    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid API token")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"Foodics API error: {resp.text[:200]}")
    data = resp.json()
    return {"status": "ok", "business": data.get("data", {}).get("business", {}).get("name", "Connected")}


# ── Fetch Foodics Branches ────────────────────────────────────

@router.get("/branches")
async def fetch_foodics_branches(db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = _require_settings(db)
    url = f"{_base_url(s)}/branches"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_headers(s))
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Failed to fetch branches from Foodics")
    branches = resp.json().get("data", [])
    return [{"id": b["id"], "name": b.get("name", ""), "name_localized": b.get("name_localized", "")} for b in branches]


# ── Branch Mappings ───────────────────────────────────────────

@router.get("/branch-mappings")
def list_branch_mappings(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(FoodicsBranchMapping).all()
    return [
        {
            "id": r.id,
            "foodics_branch_id": r.foodics_branch_id,
            "foodics_branch_name": r.foodics_branch_name,
            "local_branch_id": r.local_branch_id,
        }
        for r in rows
    ]


@router.post("/branch-mappings")
def save_branch_mapping(
    foodics_branch_id: str = Form(...),
    foodics_branch_name: str = Form(""),
    local_branch_id: int = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    existing = db.query(FoodicsBranchMapping).filter(
        FoodicsBranchMapping.foodics_branch_id == foodics_branch_id
    ).first()
    if existing:
        existing.local_branch_id = local_branch_id
        existing.foodics_branch_name = foodics_branch_name
    else:
        m = FoodicsBranchMapping(
            foodics_branch_id=foodics_branch_id,
            foodics_branch_name=foodics_branch_name,
            local_branch_id=local_branch_id,
        )
        db.add(m)
    db.commit()
    return {"status": "ok"}


# ── Fetch Foodics Payment Methods ─────────────────────────────

@router.get("/payment-methods")
async def fetch_foodics_payment_methods(db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = _require_settings(db)
    url = f"{_base_url(s)}/payment_methods"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_headers(s))
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Failed to fetch payment methods from Foodics")
    methods = resp.json().get("data", [])
    return [{"id": m["id"], "name": m.get("name", ""), "name_localized": m.get("name_localized", "")} for m in methods]


# ── Payment Mappings ──────────────────────────────────────────

@router.get("/payment-mappings")
def list_payment_mappings(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(FoodicsPaymentMapping).all()
    return [
        {
            "id": r.id,
            "foodics_payment_id": r.foodics_payment_id,
            "foodics_payment_name": r.foodics_payment_name,
            "local_channel": r.local_channel,
        }
        for r in rows
    ]


@router.post("/payment-mappings")
def save_payment_mapping(
    foodics_payment_id: str = Form(...),
    foodics_payment_name: str = Form(""),
    local_channel: str = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    existing = db.query(FoodicsPaymentMapping).filter(
        FoodicsPaymentMapping.foodics_payment_id == foodics_payment_id
    ).first()
    if existing:
        existing.local_channel = local_channel
        existing.foodics_payment_name = foodics_payment_name
    else:
        m = FoodicsPaymentMapping(
            foodics_payment_id=foodics_payment_id,
            foodics_payment_name=foodics_payment_name,
            local_channel=local_channel,
        )
        db.add(m)
    db.commit()
    return {"status": "ok"}


# ── Auto-detect Payment Mappings ──────────────────────────────

@router.post("/auto-map-payments")
async def auto_map_payments(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    s = _require_settings(db)
    url = f"{_base_url(s)}/payment_methods"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_headers(s))
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Failed to fetch payment methods")
    methods = resp.json().get("data", [])
    mapped = 0
    for m in methods:
        name_lower = (m.get("name") or "").lower()
        channel = None
        for keyword, ch in PAYMENT_CHANNEL_KEYWORDS.items():
            if keyword in name_lower:
                channel = ch
                break
        if not channel:
            continue
        existing = db.query(FoodicsPaymentMapping).filter(
            FoodicsPaymentMapping.foodics_payment_id == m["id"]
        ).first()
        if not existing:
            db.add(FoodicsPaymentMapping(
                foodics_payment_id=m["id"],
                foodics_payment_name=m.get("name", ""),
                local_channel=channel,
            ))
            mapped += 1
        elif not existing.local_channel:
            existing.local_channel = channel
            existing.foodics_payment_name = m.get("name", "")
            mapped += 1
    db.commit()
    return {"status": "ok", "mapped": mapped, "total": len(methods)}


# ── Sync Sales ────────────────────────────────────────────────

async def _fetch_orders_page(client: httpx.AsyncClient, base_url: str, headers: dict,
                             sync_date: str, page: int = 1) -> dict:
    url = (
        f"{base_url}/orders"
        f"?filter[business_date]={sync_date}"
        f"&include=payments"
        f"&page={page}"
    )
    resp = await client.get(url, headers=headers)
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code,
                            detail=f"Foodics API error fetching orders: {resp.text[:200]}")
    return resp.json()


@router.post("/sync")
async def sync_sales(
    sync_date: str = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Only owner/manager can sync")

    s = _require_settings(db)
    base = _base_url(s)
    headers = _headers(s)

    branch_map = {
        r.foodics_branch_id: r.local_branch_id
        for r in db.query(FoodicsBranchMapping).all()
        if r.local_branch_id
    }
    if not branch_map:
        raise HTTPException(status_code=400, detail="No branch mappings configured. Map Foodics branches first.")

    payment_map = {
        r.foodics_payment_id: r.local_channel
        for r in db.query(FoodicsPaymentMapping).all()
        if r.local_channel
    }
    if not payment_map:
        raise HTTPException(status_code=400, detail="No payment mappings configured. Map payment methods first.")

    # Fetch all orders for the date (paginated)
    all_orders = []
    async with httpx.AsyncClient(timeout=30) as client:
        page = 1
        while True:
            data = await _fetch_orders_page(client, base, headers, sync_date, page)
            orders = data.get("data", [])
            all_orders.extend(orders)
            meta = data.get("meta", {})
            if page >= meta.get("last_page", 1):
                break
            page += 1
            await asyncio.sleep(0.7)  # respect rate limits

    # Aggregate by branch + payment channel
    # Structure: {local_branch_id: {channel: total}}
    aggregated: dict[int, dict[str, float]] = {}
    unmapped_branches = set()
    unmapped_payments = set()

    for order in all_orders:
        branch_id_foodics = order.get("branch_id") or order.get("branch", {}).get("id")
        if not branch_id_foodics:
            continue
        local_bid = branch_map.get(branch_id_foodics)
        if not local_bid:
            unmapped_branches.add(branch_id_foodics)
            continue

        if local_bid not in aggregated:
            aggregated[local_bid] = {"cash": 0, "knet": 0, "link": 0, "wamd": 0}

        payments = order.get("payments", [])
        if isinstance(payments, dict):
            payments = payments.get("data", [])
        for pmt in payments:
            pm_id = pmt.get("payment_method_id") or pmt.get("payment_method", {}).get("id", "")
            amount = float(pmt.get("amount") or pmt.get("tendered") or 0)
            channel = payment_map.get(pm_id)
            if not channel:
                unmapped_payments.add(pm_id)
                continue
            aggregated[local_bid][channel] += amount

    # Upsert sales records
    target_date = date.fromisoformat(sync_date)
    created = 0
    updated = 0
    for local_bid, totals in aggregated.items():
        existing = db.query(Sale).filter(
            Sale.branch_id == local_bid,
            Sale.date == target_date,
        ).first()
        if existing:
            existing.foodics_cash = totals.get("cash", 0)
            existing.foodics_knet = totals.get("knet", 0)
            existing.foodics_link = totals.get("link", 0)
            existing.foodics_wamd = totals.get("wamd", 0)
            updated += 1
        else:
            sale = Sale(
                branch_id=local_bid,
                date=target_date,
                foodics_cash=totals.get("cash", 0),
                foodics_knet=totals.get("knet", 0),
                foodics_link=totals.get("link", 0),
                foodics_wamd=totals.get("wamd", 0),
                notes=f"Auto-synced from Foodics on {datetime.now(timezone.utc).isoformat()[:10]}",
                created_by=user.id,
            )
            db.add(sale)
            created += 1

    # Update last sync timestamp
    s.last_sync_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "status": "ok",
        "date": sync_date,
        "orders_fetched": len(all_orders),
        "branches_updated": updated,
        "branches_created": created,
        "unmapped_branches": list(unmapped_branches),
        "unmapped_payments": list(unmapped_payments),
    }


# ── Sync Sales for Date Range ─────────────────────────────────

@router.post("/sync-range")
async def sync_sales_range(
    start_date: str = Form(...),
    end_date: str = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Only owner/manager can sync")

    from datetime import timedelta
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    if (end - start).days > 31:
        raise HTTPException(status_code=400, detail="Maximum range is 31 days")

    results = []
    current = start
    while current <= end:
        try:
            result = await sync_sales(
                sync_date=current.isoformat(),
                db=db,
                user=user,
            )
            results.append(result)
        except HTTPException as e:
            results.append({"date": current.isoformat(), "error": e.detail})
        current += timedelta(days=1)
        await asyncio.sleep(1)  # respect rate limits between days

    return {"status": "ok", "results": results}
