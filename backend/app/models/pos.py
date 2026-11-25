from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, ForeignKey
from datetime import datetime, timezone
from app.database import Base


class PosSettings(Base):
    __tablename__ = "pos_settings"

    id = Column(Integer, primary_key=True, index=True)
    api_url = Column(String, nullable=True)  # e.g. https://pos.example.com/api/v1
    web_url = Column(String, nullable=True)  # e.g. https://pos.example.com
    api_key = Column(Text, nullable=True)  # POS integration key (posk_...)
    auto_sync = Column(Boolean, default=True, nullable=False)
    import_receipts = Column(Boolean, default=True, nullable=False)
    sso_private_key = Column(Text, nullable=True)  # Ed25519 PEM, made on first use
    webhook_secret = Column(String, nullable=True)  # the POS signs its change notices with it
    last_sync_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class PosBranchMapping(Base):
    __tablename__ = "pos_branch_mappings"

    id = Column(Integer, primary_key=True, index=True)
    pos_branch_id = Column(String, nullable=False, unique=True)
    pos_branch_name = Column(String, nullable=True)
    local_branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)


class PosPaymentMapping(Base):
    __tablename__ = "pos_payment_mappings"

    id = Column(Integer, primary_key=True, index=True)
    pos_method = Column(String, nullable=False, unique=True)
    pos_method_name = Column(String, nullable=True)
    local_channel = Column(String, nullable=False)


class PosReceipt(Base):
    """A POS goods receipt already booked as a branch purchase, so it is never booked twice."""
    __tablename__ = "pos_receipts"

    id = Column(Integer, primary_key=True, index=True)
    pos_receipt_id = Column(String, nullable=False, unique=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=True)
    total = Column(Float, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
