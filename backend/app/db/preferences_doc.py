from datetime import datetime, timezone
from typing import Any, Optional, List, Dict

def user_preferences_document(
    user_id: str,
    youtube_privacy: str = "unlisted",
    default_tags: Optional[List[str]] = None,
    default_email_signature: Optional[str] = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "user_id": user_id,
        "defaults": {
            "youtube_privacy": youtube_privacy,
            "default_tags": default_tags or ["#AI", "#Automation"],
            "default_email_signature": default_email_signature or "Sent via Autonomous AI Agent",
        },
        "notification_settings": {
            "email_on_success": True,
            "email_on_failure": True,
        },
        "created_at": now,
        "updated_at": now,
    }