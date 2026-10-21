"""Who may open the Accounting module. During testing only the users listed in acc_settings.user_ids
(by default the finance.manager login) can see it; everyone else, Owner included, is refused."""
import json
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.accounting import AccSettings
from app.models.user import User
from app.utils.auth import get_current_user

DEFAULT_ACCOUNTING_USERNAMES = ("finance.manager",)


def get_settings(db: Session) -> AccSettings:
    s = db.query(AccSettings).first()
    if not s:
        ids = [u.id for u in db.query(User).filter(User.username.in_(DEFAULT_ACCOUNTING_USERNAMES)).all()]
        s = AccSettings(id=1, user_ids=json.dumps(ids), auto_sync=True)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def accounting_user_ids(db: Session) -> list[int]:
    s = get_settings(db)
    return json.loads(s.user_ids) if s.user_ids else []


def can_use_accounting(db: Session, user: User) -> bool:
    return bool(user.is_active) and user.id in accounting_user_ids(db)


def get_accounting_user(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> User:
    if not can_use_accounting(db, user):
        raise HTTPException(status_code=403, detail="Accounting is not available for this login")
    return user
