"""The item master and the central kitchen: every stock item once (raw, as bought, or semi-processed,
made in the Central Kitchen), its batch recipe, production entries and opening stock."""
from datetime import datetime, timezone

from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint

from app.database import Base


class StockItem(Base):
    """One stock item for both brands. unit: the POS stock unit (g, kg, ml, l, piece)."""
    __tablename__ = "stock_items"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=True, unique=True)
    name = Column(String, nullable=False)
    name_ar = Column(String, nullable=True)
    kind = Column(String, nullable=False, default="raw")  # raw, semi
    category = Column(String, nullable=False, default="food")  # food, beverage, packaging
    unit = Column(String, nullable=False, default="kg")
    is_active = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class StockItemPos(Base):
    """The POS stock item an item master entry is, in one brand."""
    __tablename__ = "stock_item_pos"
    __table_args__ = (UniqueConstraint("brand_id", "stock_item_id"),)

    id = Column(Integer, primary_key=True, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False)
    stock_item_id = Column(Integer, ForeignKey("stock_items.id"), nullable=False, index=True)
    pos_ingredient_id = Column(String, nullable=False, index=True)


class ProductionRecipe(Base):
    """What one batch of a semi-processed item uses, and how much the batch makes (in the item's unit)."""
    __tablename__ = "production_recipes"

    id = Column(Integer, primary_key=True, index=True)
    stock_item_id = Column(Integer, ForeignKey("stock_items.id"), nullable=False, unique=True)
    batch_qty = Column(Float, nullable=False, default=1)
    notes = Column(Text, nullable=True)
    is_active = Column(Integer, nullable=False, default=1)


class ProductionRecipeLine(Base):
    __tablename__ = "production_recipe_lines"

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey("production_recipes.id"), nullable=False, index=True)
    stock_item_id = Column(Integer, ForeignKey("stock_items.id"), nullable=False)
    quantity = Column(Float, nullable=False)


class ProductionOrder(Base):
    """A production at the Central Kitchen. cost and unit_cost come back from the POS once posted."""
    __tablename__ = "production_orders"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    date = Column(Date, nullable=False)
    recipe_id = Column(Integer, ForeignKey("production_recipes.id"), nullable=True)
    stock_item_id = Column(Integer, ForeignKey("stock_items.id"), nullable=False)
    batches = Column(Float, nullable=False, default=1)
    expected_qty = Column(Float, nullable=False, default=0)
    output_qty = Column(Float, nullable=False)
    cost = Column(Float, nullable=True)
    unit_cost = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ProductionOrderLine(Base):
    __tablename__ = "production_order_lines"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False, index=True)
    stock_item_id = Column(Integer, ForeignKey("stock_items.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    cost = Column(Float, nullable=True)


class OpeningStock(Base):
    """Stock counted at a unit on the day costing starts, at the cost it is carried at."""
    __tablename__ = "opening_stocks"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    date = Column(Date, nullable=False)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class OpeningStockLine(Base):
    __tablename__ = "opening_stock_lines"

    id = Column(Integer, primary_key=True, index=True)
    opening_id = Column(Integer, ForeignKey("opening_stocks.id"), nullable=False, index=True)
    stock_item_id = Column(Integer, ForeignKey("stock_items.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    unit_cost = Column(Float, nullable=False, default=0)
