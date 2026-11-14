"""Keeps the ledger in step with Mudawwarah by running sync_ledger in the background."""
import logging
import threading
import time

from app.database import SessionLocal
from app.utils.ledger import sync_ledger
from app.utils.ledger_access import get_settings

INTERVAL_SECONDS = 300
log = logging.getLogger("ledger")


def _loop():
    while True:
        time.sleep(INTERVAL_SECONDS)
        db = SessionLocal()
        try:
            s = get_settings(db)
            if s.auto_sync and s.start_date:
                sync_ledger(db)
        except Exception:
            db.rollback()
            log.exception("Ledger sync failed")
        finally:
            db.close()


def start_ledger_autosync():
    threading.Thread(target=_loop, name="ledger-autosync", daemon=True).start()
