"""Unit types: what a branch row is, so screens pick units by type instead of by name."""
from typing import Optional

SALES = "sales"
CENTRAL_STORE = "central_store"
CENTRAL_KITCHEN = "central_kitchen"
ADMINISTRATION = "administration"
PURCHASE_OFFICE = "purchase_office"
PERSONNEL_OFFICE = "personnel_office"
HR_OFFICE = "hr_office"

UNIT_TYPES = (SALES, CENTRAL_STORE, CENTRAL_KITCHEN, ADMINISTRATION, PURCHASE_OFFICE, PERSONNEL_OFFICE, HR_OFFICE)
OFFICES = (PURCHASE_OFFICE, PERSONNEL_OFFICE, HR_OFFICE)
STOCK_UNITS = (SALES, CENTRAL_STORE, CENTRAL_KITCHEN)

_BY_PREFIX = (
    ("Personnel Office", PERSONNEL_OFFICE),
    ("HR Office", HR_OFFICE),
    ("Purchase Office", PURCHASE_OFFICE),
    ("Administration", ADMINISTRATION),
    ("Central Store", CENTRAL_STORE),
    ("Central Kitchen", CENTRAL_KITCHEN),
)


def infer_unit_type(name: Optional[str], is_central_kitchen: bool = False) -> str:
    """Type of a unit from its old naming convention (used once, to fill in existing rows)."""
    if is_central_kitchen:
        return CENTRAL_KITCHEN
    for prefix, kind in _BY_PREFIX:
        if (name or "").startswith(prefix):
            return kind
    return SALES
