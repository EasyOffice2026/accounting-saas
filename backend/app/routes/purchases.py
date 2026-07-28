from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional
import os, uuid, json

from app.database import get_db, UPLOAD_DIR
from app.models.purchase import (
    PurchaseCategory, Supplier, PurchaseOrder, PurchaseItem, SupplierItem,
    ReceivingOrder, ReceivingItem, Invoice, DeliveryOrder,
)
from app.models.branch import Branch
from app.models.user import User
from app.utils.auth import get_current_user
from app.routes.hr import _brand_branch_ids

router = APIRouter(prefix="/api/purchases", tags=["purchases"])


# --- Purchase Categories ---
@router.get("/categories")
def list_categories(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(PurchaseCategory).filter(PurchaseCategory.is_active == True).order_by(PurchaseCategory.name).all()


@router.post("/categories")
def create_category(name: str = Form(...), name_ar: str = Form(""),
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    existing = db.query(PurchaseCategory).filter(
        PurchaseCategory.name == name.strip(), PurchaseCategory.is_active == True
    ).first()
    if existing:
        raise HTTPException(400, "Category already exists")
    cat = PurchaseCategory(name=name.strip(), name_ar=name_ar.strip() if name_ar else None)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/categories/{cat_id}")
def update_category(cat_id: int, name: str = Form(...), name_ar: str = Form(""),
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    cat = db.query(PurchaseCategory).filter(PurchaseCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    dup = db.query(PurchaseCategory).filter(
        PurchaseCategory.name == name.strip(), PurchaseCategory.is_active == True,
        PurchaseCategory.id != cat_id,
    ).first()
    if dup:
        raise HTTPException(400, "Category already exists")
    cat.name = name.strip()
    cat.name_ar = name_ar.strip() if name_ar else None
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    cat = db.query(PurchaseCategory).filter(PurchaseCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    cat.is_active = False
    db.commit()
    return {"status": "deleted"}


# --- Suppliers ---
@router.get("/suppliers")
def list_suppliers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Supplier).filter(Supplier.is_active == True).all()


@router.post("/suppliers")
def create_supplier(name: str = Form(...), email: str = Form(""),
                    whatsapp: str = Form(""), whatsapp_group: str = Form(""),
                    payment_type: str = Form("cash"),
                    category_id: Optional[int] = Form(None),
                    db: Session = Depends(get_db), _=Depends(get_current_user)):
    s = Supplier(name=name, email=email, whatsapp=whatsapp,
                 whatsapp_group=whatsapp_group or None, payment_type=payment_type,
                 category_id=category_id if category_id else None)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, name: str = Form(...), email: str = Form(""),
                    whatsapp: str = Form(""), whatsapp_group: str = Form(""),
                    payment_type: str = Form("cash"),
                    category_id: Optional[int] = Form(None),
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not s:
        raise HTTPException(404, "Supplier not found")
    s.name = name
    s.email = email
    s.whatsapp = whatsapp
    s.whatsapp_group = whatsapp_group or None
    s.payment_type = payment_type
    s.category_id = category_id if category_id else None
    db.commit()
    db.refresh(s)
    return s


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    s = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not s:
        raise HTTPException(404, "Supplier not found")
    # Soft-delete supplier and its items
    s.is_active = False
    db.query(SupplierItem).filter(SupplierItem.supplier_id == supplier_id).update({"is_active": False})
    db.commit()
    return {"status": "deleted"}


@router.delete("/orders/{order_id}")
def delete_order(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    # Delete related records
    db.query(PurchaseItem).filter(PurchaseItem.purchase_order_id == order_id).delete()
    db.query(ReceivingItem).filter(
        ReceivingItem.receiving_order_id.in_(
            db.query(ReceivingOrder.id).filter(ReceivingOrder.purchase_order_id == order_id)
        )
    ).delete(synchronize_session=False)
    db.query(ReceivingOrder).filter(ReceivingOrder.purchase_order_id == order_id).delete()
    db.query(DeliveryOrder).filter(DeliveryOrder.purchase_order_id == order_id).delete()
    db.query(Invoice).filter(Invoice.purchase_order_id == order_id).delete()
    db.delete(order)
    db.commit()
    return {"status": "deleted"}


@router.put("/orders/{order_id}")
def update_order(
    order_id: int,
    branch_id: int = Form(...), supplier_id: int = Form(...),
    category_id: Optional[int] = Form(None),
    order_date: str = Form(...), payment_type: str = Form("cash"),
    delivery_location: str = Form(""),
    items: str = Form("[]"), notes: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    attachment_path = order.attachment_path
    if attachment and attachment.filename:
        ext = os.path.splitext(attachment.filename)[1]
        fname = f"{uuid.uuid4().hex}{ext}"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(os.path.join(UPLOAD_DIR, fname), "wb") as f:
            f.write(attachment.file.read())
        attachment_path = fname

    items_list = json.loads(items)
    total = sum(float(i.get("total", 0)) for i in items_list)

    order.branch_id = branch_id
    order.supplier_id = supplier_id
    order.category_id = category_id if category_id else None
    order.date = date.fromisoformat(order_date)
    order.payment_type = payment_type
    order.delivery_location = delivery_location or None
    order.total_amount = total
    order.attachment_path = attachment_path
    order.notes = notes

    # Replace items
    db.query(PurchaseItem).filter(PurchaseItem.purchase_order_id == order_id).delete()
    for item in items_list:
        pi = PurchaseItem(
            purchase_order_id=order_id,
            item_name=item["item_name"],
            quantity=float(item["quantity"]),
            unit=item.get("unit", "pcs"),
            unit_price=float(item["unit_price"]),
            total=float(item["total"]),
        )
        db.add(pi)
    db.commit()
    db.refresh(order)
    return order


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    db.delete(inv)
    db.commit()
    return {"status": "deleted"}


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
    unit_price: float = Form(0), category_id: Optional[int] = Form(None),
    db: Session = Depends(get_db), _=Depends(get_current_user),
):
    si = SupplierItem(
        supplier_id=supplier_id, item_name=item_name,
        item_name_ar=item_name_ar or None,
        packaging=packaging or None, unit=unit, unit_price=unit_price,
        category_id=category_id if category_id else None,
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
def list_orders(branch_id: Optional[int] = None, brand_id: Optional[int] = None,
                db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    q = db.query(PurchaseOrder)
    bb_ids = _brand_branch_ids(db, brand_id)
    if user.role == "staff" and user.branch_id:
        # Branch staff only ever see their own branch's purchase orders
        q = q.filter(PurchaseOrder.branch_id == user.branch_id)
    elif branch_id:
        q = q.filter(PurchaseOrder.branch_id == branch_id)
    elif bb_ids is not None:
        q = q.filter(PurchaseOrder.branch_id.in_(bb_ids))
    return q.order_by(PurchaseOrder.date.desc()).all()


@router.post("/orders")
def create_order(
    branch_id: int = Form(...), supplier_id: int = Form(...),
    category_id: Optional[int] = Form(None),
    order_date: str = Form(...), payment_type: str = Form("cash"),
    delivery_location: str = Form(""),
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
        category_id=category_id if category_id else None,
        date=date.fromisoformat(order_date), payment_type=payment_type,
        delivery_location=delivery_location or None,
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

    # Auto-send Arabic purchase order to supplier's WhatsApp group
    try:
        from app.routes.whatsapp import _send_to_entity_group, build_purchase_message
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if supplier and supplier.whatsapp_group:
            branch = db.query(Branch).filter(Branch.id == branch_id).first()
            msg = build_purchase_message(po, supplier, branch, items_list, "ar")
            _send_to_entity_group(db, supplier.whatsapp_group, msg)
    except Exception:
        pass

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


# --- Receiving Orders ---
@router.post("/orders/{order_id}/receive")
def receive_order(
    order_id: int,
    receive_date: str = Form(...),
    items: str = Form("[]"),
    notes: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not po:
        raise HTTPException(404, "Order not found")
    if po.status not in ("pending",):
        raise HTTPException(400, "Order already received")

    attachment_path = None
    if attachment and attachment.filename:
        ext = os.path.splitext(attachment.filename)[1]
        fname = f"{uuid.uuid4().hex}{ext}"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(os.path.join(UPLOAD_DIR, fname), "wb") as f:
            f.write(attachment.file.read())
        attachment_path = fname

    ro = ReceivingOrder(
        purchase_order_id=order_id,
        date=date.fromisoformat(receive_date),
        notes=notes, attachment_path=attachment_path,
        created_by=user.id,
    )
    db.add(ro)
    db.commit()
    db.refresh(ro)

    items_list = json.loads(items)
    recv_total = 0
    for item in items_list:
        qty = float(item["received_qty"])
        price = float(item["unit_price"])
        total = qty * price
        recv_total += total
        ri = ReceivingItem(
            receiving_order_id=ro.id,
            item_name=item["item_name"],
            ordered_qty=float(item["ordered_qty"]),
            received_qty=qty,
            unit=item.get("unit", "pcs"),
            unit_price=price,
            total=total,
        )
        db.add(ri)

    po.status = "received"
    db.commit()

    # Auto-create invoice
    inv = Invoice(
        purchase_order_id=order_id,
        supplier_id=po.supplier_id,
        branch_id=po.branch_id,
        date=date.fromisoformat(receive_date),
        total_amount=recv_total,
        status="pending",
    )
    db.add(inv)
    po.status = "invoiced"
    db.commit()
    db.refresh(inv)

    return {"receiving_order": ro.id, "invoice_id": inv.id, "total": recv_total}


@router.get("/orders/{order_id}/receiving")
def get_receiving(order_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ro = db.query(ReceivingOrder).filter(ReceivingOrder.purchase_order_id == order_id).first()
    if not ro:
        return None
    items = db.query(ReceivingItem).filter(ReceivingItem.receiving_order_id == ro.id).all()
    return {
        "id": ro.id, "date": str(ro.date), "notes": ro.notes,
        "items": [
            {"item_name": ri.item_name, "ordered_qty": ri.ordered_qty,
             "received_qty": ri.received_qty, "unit": ri.unit,
             "unit_price": ri.unit_price, "total": ri.total}
            for ri in items
        ],
    }


# --- Invoices ---
@router.get("/invoices")
def list_invoices(supplier_id: Optional[int] = None, status: Optional[str] = None,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Invoice)
    if user.role == "staff" and user.branch_id:
        q = q.filter(Invoice.branch_id == user.branch_id)
    if supplier_id:
        q = q.filter(Invoice.supplier_id == supplier_id)
    if status:
        q = q.filter(Invoice.status == status)
    invoices = q.order_by(Invoice.date.desc()).all()
    result = []
    for inv in invoices:
        supplier = db.query(Supplier).filter(Supplier.id == inv.supplier_id).first()
        branch = db.query(Branch).filter(Branch.id == inv.branch_id).first()
        result.append({
            "id": inv.id, "purchase_order_id": inv.purchase_order_id,
            "supplier_id": inv.supplier_id, "supplier_name": supplier.name if supplier else "",
            "branch_id": inv.branch_id, "branch_name": branch.name if branch else "",
            "invoice_number": inv.invoice_number, "date": str(inv.date),
            "total_amount": inv.total_amount, "status": inv.status,
            "paid_amount": inv.paid_amount, "paid_date": str(inv.paid_date) if inv.paid_date else None,
            "notes": inv.notes,
        })
    return result


@router.post("/invoices/{invoice_id}/pay")
def pay_invoice(
    invoice_id: int,
    paid_amount: float = Form(...),
    paid_date: str = Form(...),
    notes: str = Form(""),
    db: Session = Depends(get_db), _=Depends(get_current_user),
):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    inv.paid_amount = paid_amount
    inv.paid_date = date.fromisoformat(paid_date)
    inv.status = "paid"
    inv.notes = notes or inv.notes

    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == inv.purchase_order_id).first()
    if po:
        po.status = "paid"
    db.commit()
    return {"status": "paid"}


# --- Supplier Ledger ---
@router.get("/supplier-ledger")
def supplier_ledger(supplier_id: Optional[int] = None, db: Session = Depends(get_db),
                    _=Depends(get_current_user)):
    suppliers_q = db.query(Supplier).filter(Supplier.is_active == True)
    if supplier_id:
        suppliers_q = suppliers_q.filter(Supplier.id == supplier_id)
    result = []
    for s in suppliers_q.all():
        invoices = db.query(Invoice).filter(Invoice.supplier_id == s.id).order_by(Invoice.date.desc()).all()
        pending = [i for i in invoices if i.status == "pending"]
        paid = [i for i in invoices if i.status == "paid"]
        total_invoiced = sum(i.total_amount for i in invoices)
        total_paid = sum(i.paid_amount or 0 for i in invoices)
        total_pending = total_invoiced - total_paid
        result.append({
            "supplier_id": s.id, "supplier_name": s.name,
            "total_invoiced": total_invoiced, "total_paid": total_paid,
            "total_pending": total_pending,
            "pending_count": len(pending), "paid_count": len(paid),
            "invoices": [
                {"id": i.id, "po_id": i.purchase_order_id, "date": str(i.date),
                 "total_amount": i.total_amount, "status": i.status,
                 "paid_amount": i.paid_amount or 0,
                 "paid_date": str(i.paid_date) if i.paid_date else None}
                for i in invoices
            ],
        })
    return result
