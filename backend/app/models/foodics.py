from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from datetime import datetime, timezone
from app.database import Base


class FoodicsSettings(Base):
    __tablename__ = "foodics_settings"

    id = Column(Integer, primary_key=True, index=True)
    api_token = Column(Text, nullable=True)
    base_url = Column(String, default="https://api.foodics.com/v5")
    is_sandbox = Column(Boolean, default=False)
    last_sync_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class FoodicsBranchMapping(Base):
    __tablename__ = "foodics_branch_mappings"

    id = Column(Integer, primary_key=True, index=True)
    foodics_branch_id = Column(String, nullable=False, unique=True)
    foodics_branch_name = Column(String, nullable=True)
    local_branch_id = Column(Integer, nullable=True)


class FoodicsPaymentMapping(Base):
    __tablename__ = "foodics_payment_mappings"

    id = Column(Integer, primary_key=True, index=True)
    foodics_payment_id = Column(String, nullable=False, unique=True)
    foodics_payment_name = Column(String, nullable=True)
    local_channel = Column(String, nullable=True)  # cash, knet, link, wamd
