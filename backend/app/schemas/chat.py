from pydantic import BaseModel, Field


class ChatCreate(BaseModel):
    message: str = Field(..., min_length=1)