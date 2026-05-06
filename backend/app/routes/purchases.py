from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional
import os, uuid, json

from app.database import get_db
from app.models.purchase import Supplier, PurchaseOrder, PurchaseItem, SupplierItem, DeliveryOrder
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/purchases", tags=["purchases"])
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")


# --- Suppliers ---
@router.get("/suppliers")
def list_suppliers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Supplier).filter(Supplier.is_active == True).all()


@router.post("/suppliers")
def create_supplier(name: str = Form(...), email: str = Form(""),
                    whatsapp: str = Form(""), payment_type: str = Form("cash"),
                    db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = Supplier(name=name, email=email, whatsapp=whatsapp, payment_type=payment_type)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


# --- Supplier Items (Catalog) ---
@router.get("/suppliers/{supplier_id}/items")
def list_supplier_items(supplier_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(SupplierItem).filter(
        SupplierItem.supplier_id == supplier_id, SupplierItem.is_active == True
    ).order_by(SupplierItem.item_name).all()


@router.post("/suppliers/{supplier_id}/items")
def create_supplier_item(
    supplier_id: int,
    item_name: str = Form(...), item_name_ar: str = Form(""),
    packaging: str = Form(""), unit: str = Form("pcs"),
    unit_price: float = Form(0),
    db: Session = Depends(get_db), _=Depends(get_current_user),
):
    si = SupplierItem(
        supplier_id=supplier_id, item_name=item_name,
        item_name_ar=item_name_ar or None,
        packaging=packaging or None, unit=unit, unit_price=unit_price,
    )
    db.add(si)
    db.commit()
    db.refresh(si)
    return si


@router.put("/suppliers/items/{item_id}")
def update_supplier_item(
    item_id: int,
    item_name: str = Form(...), item_name_ar: str = Form(""),
    packaging: str = Form(""), unit: str = Form("pcs"),
    unit_price: float = Form(0),
    db: Session = Depends(get_db), _=Depends(get_current_user),
):
    si = db.query(SupplierItem).filter(SupplierItem.id == item_id).first()
    if not si:
        raise HTTPException(404, "Item not found")
    si.item_name = item_name
    si.item_name_ar = item_name_ar or None
    si.packaging = packaging or None
    si.unit = unit
    si.unit_price = unit_price
    db.commit()
    db.refresh(si)
    return si


@router.delete("/suppliers/items/{item_id}")
def delete_supplier_item(item_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    si = db.query(SupplierItem).filter(SupplierItem.id == item_id).first()
    if not si:
        raise HTTPException(404, "Item not found")
    si.is_active = False
    db.commit()
    return {"status": "deleted"}


# --- Purchase Orders ---
@router.get("/orders")
def list_orders(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    q = db.query(PurchaseOrder)
    if branch_id:
        q = q.filter(PurchaseOrder.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(PurchaseOrder.branch_id == user.branch_id)
    return q.order_by(PurchaseOrder.date.desc()).all()


@router.post("/orders")
def create_order(
    branch_id: int = Form(...), supplier_id: int = Form(...),
    order_date: str = Form(...), payment_type: str = Form("cash"),
    items: str = Form("[]"), notes: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    attachment_path = None
    if attachment and attachment.filename:
        ext = os.path.splitext(attachment.filename)[1]
        fname = f"{uuid.uuid4().hex}{ext}"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(os.path.join(UPLOAD_DIR, fname), "wb") as f:
            f.write(attachment.file.read())
        attachment_path = fname

    items_list = json.loads(items)
    total = sum(float(i.get("total", 0)) for i in items_list)

    po = PurchaseOrder(
        branch_id=branch_id, supplier_id=supplier_id,
        date=date.fromisoformat(order_date), payment_type=payment_type,
        total_amount=total, attachment_path=attachment_path,
        notes=notes, created_by=user.id,
    )
    db.add(po)
    db.commit()
    db.refresh(po)

    for item in items_list:
        pi = PurchaseItem(
            purchase_order_id=po.id,
            item_name=item["item_name"],
            quantity=float(item["quantity"]),
            unit=item.get("unit", "pcs"),
            unit_price=float(item["unit_price"]),
            total=float(item["total"]),
        )
        db.add(pi)
    db.commit()
    return po


@router.get("/orders/{order_id}/items")
def get_order_items(order_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(PurchaseItem).filter(PurchaseItem.purchase_order_id == order_id).all()


# --- Delivery Orders ---
@router.post("/delivery")
def create_delivery(
    purchase_order_id: int = Form(...), delivery_date: str = Form(...),
    item_name: str = Form(...), ordered_qty: float = Form(...),
    received_qty: float = Form(...), notes: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db), _=Depends(get_current_user),
):
    attachment_path = None
    if attachment and attachment.filename:
        ext = os.path.splitext(attachment.filename)[1]
        fname = f"{uuid.uuid4().hex}{ext}"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(os.path.join(UPLOAD_DIR, fname), "wb") as f:
            f.write(attachment.file.read())
        attachment_path = fname

    do = DeliveryOrder(
        purchase_order_id=purchase_order_id,
        date=date.fromisoformat(delivery_date),
        item_name=item_name, ordered_qty=ordered_qty,
        received_qty=received_qty,
        difference=ordered_qty - received_qty,
        notes=notes, attachment_path=attachment_path,
    )
    db.add(do)
    db.commit()
    db.refresh(do)
    return do


@router.get("/supplier-ledger")
def supplier_ledger(supplier_id: Optional[int] = None, db: Session = Depends(get_db),
                    _=Depends(get_current_user)):
    q = db.query(PurchaseOrder)
    if supplier_id:
        q = q.filter(PurchaseOrder.supplier_id == supplier_id)
    orders = q.order_by(PurchaseOrder.date.desc()).all()
    total = sum(o.total_amount or 0 for o in orders)
    return {"orders": orders, "total": total}
