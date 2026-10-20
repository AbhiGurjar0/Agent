# app/core/security.py
from datetime import datetime, timedelta, timezone
import hashlib
import bcrypt
import jwt
from app.core.config import settings


def _get_password_bytes(password: str) -> bytes:
    """
    Safely converts password to bytes and enforces the 72-byte bcrypt limit
    by SHA-256 hashing long inputs first.
    """
    pwd_bytes = password.encode("utf-8")
    if len(pwd_bytes) > 72:
        pwd_bytes = hashlib.sha256(pwd_bytes).digest()
    return pwd_bytes


def hash_password(password: str) -> str:
    """Hashes a plaintext password safely using native bcrypt."""
    pwd_bytes = _get_password_bytes(password)
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against a stored bcrypt hash."""
    try:
        pwd_bytes = _get_password_bytes(plain_password)
        hash_bytes = hashed_password.encode("utf-8")
        return bcrypt.checkpw(pwd_bytes, hash_bytes)
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Generates a signed JWT access token for authentication."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    
    encoded_jwt = jwt.encode(
        to_encode, 
        settings.JWT_SECRET_KEY, 
        algorithm=settings.JWT_ALGORITHM
    )
    return encoded_jwt