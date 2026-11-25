from sqlalchemy import Column, Integer, String, Text, DateTime, Date, Boolean, Float, ForeignKey, UniqueConstraint
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
    # Stock purchases go to Inventory, and the POS takes them off as recipes are sold.
    inventory_accounting = Column(Boolean, default=False, nullable=False)
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


class PosStockLink(Base):
    """A Mudawwarah purchase or transfer item and the POS stock item it is, for one brand.
    factor: POS units in one Mudawwarah unit (one 10 kg bag = 10 kg)."""
    __tablename__ = "pos_stock_links"
    __table_args__ = (UniqueConstraint("brand_id", "source", "item_id"),)

    id = Column(Integer, primary_key=True, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False)
    source = Column(String, nullable=False)  # supplier_item, transfer_item
    item_id = Column(Integer, nullable=False)
    pos_ingredient_id = Column(String, nullable=False, index=True)
    pos_ingredient_name = Column(String, nullable=True)
    factor = Column(Float, nullable=False, default=1)
    category = Column(String, nullable=False, default="food")  # food, beverage, packaging


class PosStockPush(Base):
    """Stock to post into the POS (goods received, transfers), sent once and retried until it is in."""
    __tablename__ = "pos_stock_pushes"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, nullable=False, unique=True)
    payload = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending, done, error
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    pushed_at = Column(DateTime, nullable=True)


class PosStockCost(Base):
    """What a branch used up in a day, by stock category: sold (by recipe), waste, count difference."""
    __tablename__ = "pos_stock_costs"
    __table_args__ = (UniqueConstraint("branch_id", "date", "category", "kind"),)

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    category = Column(String, nullable=False)
    kind = Column(String, nullable=False)  # sold, waste, count
    cost = Column(Float, nullable=False, default=0)
