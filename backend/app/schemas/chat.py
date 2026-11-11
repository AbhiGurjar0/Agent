from pydantic import BaseModel, Field
from typing import List, Optional


class ChatCreate(BaseModel):
    convo_id: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    images: Optional[List[str]] = None