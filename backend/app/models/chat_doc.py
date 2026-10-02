from datetime import datetime, timezone
from typing import Any, Optional, List, Dict
import uuid


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_message_dict(
    role: str = "user",
    content: str = "",
    tool_calls: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Generates a single structured chat message dictionary."""
    return {
        "id": str(uuid.uuid4()),
        "role": role,
        "content": content,
        "tool_calls": tool_calls or [],
        "created_at": utc_now(),
    }


def chat_thread_document(
    user_id: str,
    thread_type: str = "general",
    initial_message: Optional[str] = None,
) -> Dict[str, Any]:
    """Generates a new chat thread document for MongoDB."""
    now = utc_now()
    
    messages = []
    if initial_message:
        messages.append(
            create_message_dict(role="user", content=initial_message)
        )

    return {
        "user_id": user_id,
        "type": thread_type or "general",
        "messages": messages,
        "created_at": now,
        "updated_at": now,
    }