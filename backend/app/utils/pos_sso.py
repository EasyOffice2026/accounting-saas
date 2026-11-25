"""Signs a one-minute Ed25519 ticket that signs a Mudawwarah user in to the POS (matched by email).
The POS checks it against the public key at /api/pos/sso/jwks.json."""
import base64
import hashlib
import json
import os
import time
import uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy.orm import Session

from app.models.pos import PosSettings

AUDIENCE = os.environ.get("POS_SSO_AUDIENCE", "pos")
TICKET_SECONDS = 60


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _private_key(db: Session, s: PosSettings) -> Ed25519PrivateKey:
    if not s.sso_private_key:
        key = Ed25519PrivateKey.generate()
        s.sso_private_key = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
        ).decode()
        db.commit()
    return serialization.load_pem_private_key(s.sso_private_key.encode(), password=None)


def _public_raw(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def _kid(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()[:16]


def jwks(db: Session, s: PosSettings) -> dict:
    raw = _public_raw(_private_key(db, s))
    return {"keys": [{"kty": "OKP", "crv": "Ed25519", "x": _b64(raw), "kid": _kid(raw), "alg": "EdDSA", "use": "sig"}]}


def ticket(db: Session, s: PosSettings, issuer: str, user_id: int, email: str) -> str:
    key = _private_key(db, s)
    now = int(time.time())
    header = {"alg": "EdDSA", "typ": "JWT", "kid": _kid(_public_raw(key))}
    payload = {"iss": issuer, "aud": AUDIENCE, "sub": str(user_id), "email": email.lower(),
               "jti": str(uuid.uuid4()), "iat": now, "exp": now + TICKET_SECONDS}
    signing_input = f"{_b64(json.dumps(header, separators=(',', ':')).encode())}." \
                    f"{_b64(json.dumps(payload, separators=(',', ':')).encode())}"
    return f"{signing_input}.{_b64(key.sign(signing_input.encode()))}"


def issuer_for(base_url: str) -> str:
    return os.environ.get("PUBLIC_URL", base_url).rstrip("/")
