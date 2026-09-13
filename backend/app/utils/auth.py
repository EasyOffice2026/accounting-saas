from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User

SECRET_KEY = "mudawwarah-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found")
    return user


PURCHASE_ROLES = ("purchase_officer", "purchase_manager")
MODULE_RESTRICTED_ROLES = ("personnel", "personnel_manager") + PURCHASE_ROLES

# API prefixes the Purchase Office roles may call; everything else under /api is refused server-side.
PURCHASE_ALLOWED_PREFIXES = ("/api/auth/", "/api/procurement/", "/api/cash/", "/api/branches/", "/api/hr/brands")


def get_business_user(user: User = Depends(get_current_user)) -> User:
    """Sales / purchases / operating dashboard are not available to module-restricted roles."""
    if user.role in MODULE_RESTRICTED_ROLES:
        raise HTTPException(status_code=403, detail="Not available for this role")
    return user


class PurchaseScopeMiddleware(BaseHTTPMiddleware):
    """Hard-limits Purchase Office logins to the procurement module + their cash box (role is in the JWT)."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        allowed = path.startswith(PURCHASE_ALLOWED_PREFIXES) and (
            request.method == "GET" or path.startswith(("/api/auth/", "/api/procurement/", "/api/cash/")))
        if path.startswith("/api/") and not allowed:
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                try:
                    role = jwt.decode(auth[7:], SECRET_KEY, algorithms=[ALGORITHM]).get("role")
                except JWTError:
                    role = None
                if role in PURCHASE_ROLES:
                    return JSONResponse({"detail": "Not available for this role"}, status_code=403)
        return await call_next(request)
