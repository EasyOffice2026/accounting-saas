from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, DateTime, Text, Boolean
from datetime import datetime, timezone
from app.database import Base


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    whatsapp = Column(String, nullable=True)
    payment_type = Column(String, default="cash")  # cash, credit
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    date = Column(Date, nullable=False)
    payment_type = Column(String, default="cash")  # cash, credit
    total_amount = Column(Float, default=0)
    attachment_path = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String, default="pending")  # pending, received, partial
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    item_name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String, default="pcs")
    unit_price = Column(Float, nullable=False)
    total = Column(Float, nullable=False)


class SupplierItem(Base):
    __tablename__ = "supplier_items"

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    item_name = Column(String, nullable=False)
    item_name_ar = Column(String, nullable=True)
    packaging = Column(String, nullable=True)  # e.g. "6x1.5L", "Box of 24", "10kg bag"
    unit = Column(String, default="pcs")  # pcs, kg, box, carton, pack, liter
    unit_price = Column(Float, nullable=False, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DeliveryOrder(Base):
    __tablename__ = "delivery_orders"

    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    date = Column(Date, nullable=False)
    item_name = Column(String, nullable=False)
    ordered_qty = Column(Float, nullable=False)
    received_qty = Column(Float, nullable=False)
    difference = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    attachment_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
