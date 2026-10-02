from datetime import datetime, timezone
from typing import Any, Optional


def user_document(
    email: str,
    hashed_password: str,
    full_name: str,
    role: Optional[str] = "user",
    youtube_refresh_token: Optional[str] = None,
    meta_access_token: Optional[str] = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)

    return {
        "email": email,
        "hashed_password": hashed_password,
        "full_name": full_name,
        "role": role or "user",
        "is_active": True,
        # Integrated API Credentials for your AI Agent actions
        "youtube_refresh_token": youtube_refresh_token,
        "meta_access_token": meta_access_token,
        "instagram_account_id": None,
        "facebook_page_id": None,
        "created_at": now,
        "updated_at": now,
    }