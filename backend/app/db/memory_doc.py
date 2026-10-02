from datetime import datetime, timezone
from typing import Any, Optional, List

def agent_memory_document(
    user_id: str,
    key: str,
    value: Any,
    memory_type: str = "fact",
    vector_embedding: Optional[List[float]] = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "user_id": user_id,
        "key": key,
        "value": value,
        "memory_type": memory_type,
        "vector_embedding": vector_embedding or [],
        "created_at": now,
        "updated_at": now,
    }