from app.utils import units


def test_layers():
    assert units.layer_of("sales") == units.LAYER_SALES
    assert units.layer_of(None) == units.LAYER_SALES
    for t in ("administration", "accounts_office", "purchase_office", "hr_office", "personnel_office",
              "central_store", "central_kitchen"):
        assert units.layer_of(t) == units.LAYER_ADMIN
    assert units.types_in(units.LAYER_SALES) == ("sales",)
    assert units.infer_unit_type("Accounts – Mudawwarah") == units.ACCOUNTS_OFFICE
