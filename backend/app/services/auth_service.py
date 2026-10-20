# app/services/auth_service.py
from fastapi import HTTPException, status
from app.db.database import get_database
from app.db.user_doc import user_document
from app.models.user import UserCreate, UserResponse
from app.core.security import hash_password, verify_password, create_access_token

db = get_database()

async def register_user(user_in: UserCreate) -> dict:
    """
    Registers a new user in MongoDB after verifying the email doesn't exist.
    Creates default preferences and returns public user details.
    """
    # 1. Check if user with given email already exists
    existing_user = await db["users"].find_one({"email": user_in.email.lower()})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email address already exists."
        )

    # 2. Hash password and build standard user document
    hashed_pwd = hash_password(user_in.password)
    user_doc = user_document(
        email=user_in.email.lower(),
        hashed_password=hashed_pwd,
        full_name=user_in.full_name,
        role=user_in.role
    )

    # 3. Save user to MongoDB
    result = await db["users"].insert_one(user_doc)
    user_id = str(result.inserted_id)

    # 4. Initialize default preferences document for the new user
    await db["user_preferences"].insert_one({
        "user_id": user_id,
        "defaults": {
            "youtube_privacy": "unlisted",
            "default_tags": ["#AI", "#Automation"],
            "default_email_signature": "Sent via AI Agent"
        },
        "notification_settings": {"email_on_success": True, "email_on_failure": True}
    })

    # 5. Format response payload without password or secrets
    user_doc["_id"] = user_id
    return {
        "status": "success",
        "message": "User registered successfully!",
        "user": UserResponse(**user_doc)
    }


async def login_user(email: str, password: str) -> dict:
    """
    Authenticates user credentials and returns a JWT Bearer Token.
    """
    # 1. Search for user by email
    user = await db["users"].find_one({"email": email.lower()})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2. Verify password hash
    if not verify_password(password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Ensure account is active
    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User account is inactive."
        )

    # 4. Create JWT Token payload
    user_id = str(user["_id"])
    access_token = create_access_token(
        data={"sub": user_id, "email": user["email"], "role": user.get("role", "user")}
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user_id,
        "email": user["email"],
        "full_name": user.get("full_name", "")
    }