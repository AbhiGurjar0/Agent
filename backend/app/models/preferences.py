from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class SocialMediaDefaults(BaseModel):
    youtube_privacy: str = "unlisted"  # "public", "private", "unlisted"
    default_tags: List[str] = ["#AI", "#Automation"]
    default_caption_prefix: Optional[str] = None
    default_email_signature: Optional[str] = None

class UserPreferencesInDB(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    user_id: str
    defaults: SocialMediaDefaults = Field(default_factory=SocialMediaDefaults)
    notification_settings: Dict[str, bool] = {"email_on_success": True, "email_on_failure": True}
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    model_config = {"populate_by_name": True}