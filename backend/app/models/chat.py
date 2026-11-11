from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
import uuid

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

# 1. NEW: Schema for Execution Journal entries used for task revocation
class JournalEntry(BaseModel):
    task_id: int
    tool_name: str
    args: Dict[str, Any]
    rollback_data: Dict[str, Any]
    status: Literal["completed", "revoked"] = "completed"
    created_at: datetime = Field(default_factory=utc_now)

class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: Literal["user", "assistant", "system", "tool"] = "user"
    content: str
    tool_calls: Optional[List[Dict[str, Any]]] = None
    
    # 2. NEW: Track side effects and execution time per message
    journal_entries: Optional[List[JournalEntry]] = None
    latency_ms: Optional[float] = None
    
    created_at: datetime = Field(default_factory=utc_now)

class ChatThreadCreate(BaseModel):
    user_id: str
    type: str = "general_chat"  # e.g., "youtube_uploader", "general_chat"
    initial_message: Optional[str] = None

class ChatThreadInDB(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    user_id: str
    type: str = "general_chat"
    messages: List[ChatMessage] = Field(default_factory=list)
    convo_id:str
    title: Optional[str] = None
    
    # 3. FIXED: Embeddings are returned as arrays of floats, not strings
    embeddings: Optional[List[float]] = None
    
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
    }