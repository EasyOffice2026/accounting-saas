"""General ledger. Each brand is a separate company (own chart of accounts and journals); branches are cost centres.
Journals with a source_key are derived from Mudawwarah records by app.utils.ledger and never edited in place:
a changed or deleted source is reversed and, if still present, posted again."""
from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, DateTime, Text, Boolean, UniqueConstraint
from datetime import datetime, timezone
from app.database import Base


class AccAccount(Base):
    __tablename__ = "acc_accounts"
    __table_args__ = (UniqueConstraint("brand_id", "code", name="uq_acc_account_code"),)

    id = Column(Integer, primary_key=True, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False, index=True)
    code = Column(String, nullable=False)
    name = Column(String, nullable=False)
    name_ar = Column(String, nullable=True)
    type = Column(String, nullable=False)  # ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    subtype = Column(String, nullable=True)
    parent_code = Column(String, nullable=True)
    is_header = Column(Boolean, default=False)
    concept = Column(String, nullable=True)  # IFRS taxonomy element for XBRL
    system_key = Column(String, nullable=True, index=True)  # e.g. cashbox:5, channel:2
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class AccMapping(Base):
    """Which account a Mudawwarah item posts to, e.g. kind='expense_category', ref_id=12 -> account 6220."""
    __tablename__ = "acc_mappings"
    __table_args__ = (UniqueConstraint("brand_id", "kind", "ref_id", name="uq_acc_mapping"),)

    id = Column(Integer, primary_key=True, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False)
    kind = Column(String, nullable=False)  # expense_category, purchase_category, setting
    ref_id = Column(String, nullable=False)
    account_id = Column(Integer, ForeignKey("acc_accounts.id"), nullable=False)


class AccJournal(Base):
    __tablename__ = "acc_journals"

    id = Column(Integer, primary_key=True, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False, index=True)
    number = Column(Integer, nullable=False)
    date = Column(Date, nullable=False, index=True)
    description = Column(String, nullable=False)
    source = Column(String, nullable=False, default="manual")  # manual, opening, sale, expense, ...
    source_key = Column(String, nullable=True, index=True)  # e.g. sale:123; null for manual
    source_hash = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, index=True)  # false once reversed
    reversal_of = Column(Integer, ForeignKey("acc_journals.id"), nullable=True)
    reversed_by = Column(Integer, ForeignKey("acc_journals.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class AccJournalLine(Base):
    __tablename__ = "acc_journal_lines"

    id = Column(Integer, primary_key=True, index=True)
    journal_id = Column(Integer, ForeignKey("acc_journals.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("acc_accounts.id"), nullable=False, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    debit = Column(Float, default=0)
    credit = Column(Float, default=0)
    memo = Column(String, nullable=True)
    party = Column(String, nullable=True, index=True)


class AccSettings(Base):
    __tablename__ = "acc_settings"

    id = Column(Integer, primary_key=True)
    start_date = Column(Date, nullable=True)  # sources dated before this are not posted
    auto_sync = Column(Boolean, default=True)
    user_ids = Column(Text, nullable=True)  # JSON array of user ids allowed to open Accounting
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_result = Column(Text, nullable=True)
