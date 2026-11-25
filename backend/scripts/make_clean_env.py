"""Makes a clean copy of a Mudawwarah database: the setup (brands, branches, users, chart of
accounts, channels, suppliers and lists) without any transactions.

    python scripts/make_clean_env.py SOURCE.db TARGET.db

SOURCE is only read. TARGET must not exist yet."""
import os
import sqlite3
import sys

KEEP = {
    "brands", "branches", "users",
    "acc_accounts", "acc_mappings", "acc_settings",
    "payment_channels", "proceeds_channel_map",
    "suppliers", "supplier_items", "purchase_categories", "expense_categories", "items",
    "renewal_types", "employers",
}
# Column values that belong to the old environment's activity, not its setup.
RESET = {
    "acc_settings": {"last_sync_at": None, "last_sync_result": None},
    "branches": {"sales_unlock_until": None},
}


def main(source: str, target: str) -> None:
    if os.path.exists(target):
        sys.exit(f"{target} already exists")
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst = sqlite3.connect(target)
    src.backup(dst)
    src.close()

    tables = [r[0] for r in dst.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    dst.execute("PRAGMA foreign_keys=OFF")
    for table in tables:
        if table not in KEEP:
            dst.execute(f'DELETE FROM "{table}"')
    for table, values in RESET.items():
        if table in tables:
            cols = {r[1] for r in dst.execute(f'PRAGMA table_info("{table}")')}
            sets = {k: v for k, v in values.items() if k in cols}
            if sets:
                dst.execute(f'UPDATE "{table}" SET ' + ", ".join(f"{k}=?" for k in sets), list(sets.values()))
    if "sqlite_sequence" in [r[0] for r in dst.execute("SELECT name FROM sqlite_master")]:
        dst.execute("DELETE FROM sqlite_sequence WHERE name NOT IN (%s)" % ",".join("?" * len(KEEP)), sorted(KEEP))
    dst.commit()
    dst.execute("VACUUM")

    print("Kept:")
    for table in tables:
        n = dst.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        if table in KEEP:
            print(f"  {table}: {n}")
    left = [t for t in tables if t not in KEEP and dst.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]]
    if left:
        sys.exit(f"Transactions left in {left}")
    dst.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
