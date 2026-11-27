import json
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

from app.database import Base
from app.models import *  # noqa: F401,F403
from app.models.branch import Branch
from app.models.hr import Brand
from app.models.inventory import (OpeningStock, OpeningStockLine, ProductionOrder, ProductionOrderLine, StockItem,
                                  StockItemPos)
from app.models.pos import PosBranchMapping, PosStockCost, PosStockPush
from app.models.procurement import ProcInvoice, ProcOrder, ProcOrderItem
from app.models.purchase import Supplier, SupplierItem
from app.utils import pos_stock
from app.utils.ledger import Ledger, build_entries, ensure_chart
from app.utils.pos_sync import get_settings


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Brand(id=1, name_en="Mudawwarah"))
    s.add(Branch(id=1, name="Al Aqeelah", brand_id=1, unit_type="sales"))
    s.add(Branch(id=2, name="Central Store - Mudawwarah", brand_id=1, unit_type="central_store"))
    s.add(Branch(id=3, name="Central Kitchen", brand_id=1, unit_type="central_kitchen"))
    for pos_id, local in (("b-1", 1), ("store-1", 2), ("ck-1", 3)):
        s.add(PosBranchMapping(pos_branch_id=pos_id, local_branch_id=local))
    s.add(StockItem(id=1, name="Flour", kind="raw", category="food", unit="kg"))
    s.add(StockItem(id=2, name="Oil", kind="raw", category="food", unit="l"))
    s.add(StockItem(id=3, name="Dough", kind="semi", category="food", unit="kg"))
    s.add(StockItem(id=4, name="Box", kind="raw", category="packaging", unit="piece"))
    for sid, ing in ((1, "ing-flour"), (2, "ing-oil"), (3, "ing-dough"), (4, "ing-box")):
        s.add(StockItemPos(brand_id=1, stock_item_id=sid, pos_ingredient_id=ing))
    s.add(Supplier(id=1, name="Mills"))
    s.add(SupplierItem(id=5, supplier_id=1, item_name="Flour 10kg", unit_price=3, stock_item_id=1, stock_factor=10))
    get_settings(s).inventory_accounting = True
    s.commit()
    ensure_chart(s)
    yield s
    s.close()


def lines_of(L, entry):
    code_of = {acc: code for (_, code), acc in L.by_code.items()}
    return sorted((code_of[ln[0]], ln[1], round(ln[2], 3), round(ln[3], 3)) for ln in entry.lines)


class Client:
    def __init__(self, answers):
        self.answers, self.posted = answers, []

    def post(self, path, body):
        self.posted.append((path, body))
        return self.answers.get(path, {})


def test_supplier_item_goes_to_pos_through_the_item_master(db):
    db.add(ProcOrder(id=1, po_no="PO-1", brand_id=1, supplier_id=1, date=date(2026, 11, 19)))
    db.add(ProcOrderItem(order_id=1, supplier_item_id=5, item_name="Flour 10kg", quantity=2, unit_price=3,
                         received_qty=2, received_total=6))
    db.commit()
    assert pos_stock.queue_central_receipt(db, db.get(ProcOrder, 1))
    body = json.loads(db.query(PosStockPush).one().payload)
    assert body["lines"] == [{"ingredientId": "ing-flour", "quantity": "20.000", "unitCost": "0.300"}]


def test_production_moves_value_from_ingredients_to_the_prepared_item(db):
    db.add(ProductionOrder(id=1, branch_id=3, date=date(2026, 11, 20), stock_item_id=3, batches=1, expected_qty=12,
                           output_qty=11.5))
    db.add(ProductionOrderLine(order_id=1, stock_item_id=1, quantity=10))
    db.add(ProductionOrderLine(order_id=1, stock_item_id=2, quantity=1))
    db.add(ProductionOrderLine(order_id=1, stock_item_id=4, quantity=5))
    db.commit()
    assert pos_stock.queue_production(db, db.get(ProductionOrder, 1))
    db.commit()
    client = Client({"/accounting/production": {"cost": "4.500", "unitCost": "0.391", "inputs": [
        {"ingredientId": "ing-flour", "cost": "3.000"}, {"ingredientId": "ing-oil", "cost": "1.000"},
        {"ingredientId": "ing-box", "cost": "0.500"}]}})
    assert pos_stock.push_pending(db, client)["stock_posted"] == 1
    path, body = client.posted[0]
    assert path == "/accounting/production"
    assert (body["branchId"], body["outputIngredientId"], body["outputQuantity"]) == ("ck-1", "ing-dough", "11.500")
    order = db.get(ProductionOrder, 1)
    assert (order.cost, order.unit_cost) == (4.5, 0.391)

    L = Ledger(db)
    [e] = [e for e in build_entries(db, L, date(2026, 11, 1)) if e.source == "production"]
    assert lines_of(L, e) == [("1310", 3, 0, 1.0), ("1310", 3, 0, 3.0), ("1310", 3, 4.5, 0), ("1330", 3, 0, 0.5)]


def test_opening_stock_is_inventory_against_opening_equity(db):
    db.add(OpeningStock(id=1, branch_id=1, date=date(2026, 11, 1)))
    db.add(OpeningStockLine(opening_id=1, stock_item_id=1, quantity=5, unit_cost=0.3))
    db.commit()
    assert pos_stock.queue_opening(db, db.get(OpeningStock, 1))
    body = json.loads(db.query(PosStockPush).one().payload)
    assert (body["branchId"], body["kind"]) == ("b-1", "received")
    L = Ledger(db)
    [e] = [e for e in build_entries(db, L, date(2026, 11, 1)) if e.key == "opening_stock:1"]
    assert lines_of(L, e) == [("1310", 1, 1.5, 0), ("3100", None, 0, 1.5)]


def test_invoice_difference_corrects_stock_and_books_the_used_part_to_cost(db):
    db.add(ProcOrder(id=1, po_no="PO-1", brand_id=1, supplier_id=1, date=date(2026, 11, 19)))
    db.add(ProcOrderItem(order_id=1, supplier_item_id=5, item_name="Flour 10kg", quantity=2, unit_price=3,
                         received_qty=2, received_total=6))
    db.add(ProcInvoice(id=7, order_id=1, brand_id=1, supplier_id=1, date=date(2026, 11, 21), total_amount=7))
    db.commit()
    assert pos_stock.queue_invoice_difference(db, db.get(ProcOrder, 1), 7, 7)
    assert not pos_stock.queue_invoice_difference(db, db.get(ProcOrder, 1), 7, 7)
    db.commit()
    client = Client({"/accounting/revalue": {"lines": [
        {"ingredientId": "ing-flour", "applied": "0.400", "unapplied": "0.600"}]}})
    pos_stock.push_pending(db, client)
    path, body = client.posted[0]
    assert path == "/accounting/revalue"
    assert body["lines"] == [{"ingredientId": "ing-flour", "receivedQuantity": "20.000", "amount": "1.000"}]
    L = Ledger(db)
    [e] = [e for e in build_entries(db, L, date(2026, 11, 1)) if e.source == "stock_revalue"]
    assert lines_of(L, e) == [("1310", 2, 0, 0.6), ("5110", 2, 0.6, 0)]


def test_production_usage_is_not_booked_as_cost_of_sales(db):
    when = date(2026, 11, 20)
    pos_stock.apply_costs(db, [
        {"branchId": "ck-1", "businessDate": when.isoformat(), "ingredientId": "ing-flour", "kind": "used_in_production",
         "cost": "3.000"},
        {"branchId": "b-1", "businessDate": when.isoformat(), "ingredientId": "ing-dough", "kind": "sold", "cost": "0.400"},
    ], when, when)
    assert [(c.branch_id, c.kind, c.cost) for c in db.query(PosStockCost).all()] == [(1, "sold", 0.4)]
