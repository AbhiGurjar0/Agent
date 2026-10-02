from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class AgentMemoryInDB(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    user_id: str
    key: str                             # Category/Identifier (e.g., "contacts", "posting_time")
    value: Any                           # Stored fact/data
    memory_type: str = "fact"            # "fact", "instruction", "entity", "user_rule"
    vector_embedding: Optional[List[float]] = None  # Vector for semantic retrieval (optional)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    model_config = {"populate_by_name": True}