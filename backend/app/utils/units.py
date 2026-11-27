"""Unit types: what a branch row is, so screens pick units by type instead of by name."""
from typing import Optional

SALES = "sales"
CENTRAL_STORE = "central_store"
CENTRAL_KITCHEN = "central_kitchen"
ADMINISTRATION = "administration"
PURCHASE_OFFICE = "purchase_office"
PERSONNEL_OFFICE = "personnel_office"
HR_OFFICE = "hr_office"
ACCOUNTS_OFFICE = "accounts_office"

UNIT_TYPES = (SALES, ADMINISTRATION, ACCOUNTS_OFFICE, PURCHASE_OFFICE, HR_OFFICE, PERSONNEL_OFFICE, CENTRAL_STORE,
              CENTRAL_KITCHEN)
OFFICES = (ACCOUNTS_OFFICE, PURCHASE_OFFICE, PERSONNEL_OFFICE, HR_OFFICE)

# Two layers: sales units (the branches that sell) and administrative units (everything else, including the
# central stores and kitchen). Combined costs that belong to no single unit go to the brand's Administration.
LAYER_SALES = "sales"
LAYER_ADMIN = "administrative"
LAYERS = (LAYER_SALES, LAYER_ADMIN)
STOCK_UNITS = (SALES, CENTRAL_STORE, CENTRAL_KITCHEN)

_BY_PREFIX = (
    ("Personnel Office", PERSONNEL_OFFICE),
    ("HR Office", HR_OFFICE),
    ("Purchase Office", PURCHASE_OFFICE),
    ("Accounts", ACCOUNTS_OFFICE),
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


def layer_of(unit_type: Optional[str]) -> str:
    return LAYER_SALES if (unit_type or SALES) == SALES else LAYER_ADMIN


def types_in(layer: str) -> tuple[str, ...]:
    return tuple(t for t in UNIT_TYPES if layer_of(t) == layer)
