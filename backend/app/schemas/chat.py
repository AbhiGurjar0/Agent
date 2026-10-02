from pydantic import BaseModel, Field


class ChatCreate(BaseModel):
    type:str
    message: str = Field(..., min_length=1)