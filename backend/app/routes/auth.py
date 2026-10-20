

# app/routes/auth.py
from fastapi import APIRouter, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from app.models.user import UserCreate, UserResponse
from app.services.auth_service import register_user, login_user

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(user_in: UserCreate):
    """Endpoint to register a new user."""
    return await register_user(user_in)


@router.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    OAuth2 compatible token login endpoint. 
    Expects form fields: `username` (email) and `password`.
    """
    return await login_user(email=form_data.username, password=form_data.password)