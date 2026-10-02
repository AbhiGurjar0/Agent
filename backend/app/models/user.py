from datetime import datetime, timezone
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# Base User schema with shared attributes
class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    role: str = "user"  # "user" or "admin"
    is_active: bool = True


# Schema for creating a new user (Request Body)
class UserCreate(UserBase):
    password: str = Field(..., min_length=8, description="Plaintext user password")


# Full User schema representing MongoDB Document
class UserInDB(UserBase):
    id: Optional[str] = Field(default=None, alias="_id")
    hashed_password: str
    
    # Store dynamic OAuth tokens & API configurations
    youtube_refresh_token: Optional[str] = None
    meta_access_token: Optional[str] = None
    instagram_account_id: Optional[str] = None
    facebook_page_id: Optional[str] = None

    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
    }


# Public User Response schema (Excludes secret tokens & passwords)
class UserResponse(UserBase):
    id: str = Field(..., alias="_id")
    created_at: datetime
    updated_at: datetime

    model_config = {
        "populate_by_name": True,
    }