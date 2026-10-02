from app.db.database import db

async def save_user_memory(user_id: str, memory_type: str, content: dict):
    """Saves user preferences, post histories, or key facts to MongoDB."""
    await db["agent_memories"].update_one(
        {"user_id": user_id, "memory_type": memory_type},
        {"$set": {"content": content, "updated_at": db.command("serverStatus")}},
        upsert=True
    )

async def get_user_memories(user_id: str) -> list:
    """Retrieves all stored context for the current user."""
    cursor = db["agent_memories"].find({"user_id": user_id})
    return await cursor.to_list(length=100)