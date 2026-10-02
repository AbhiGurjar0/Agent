# app/services/context_builder.py
from app.db.database import db

async def build_agent_context(user_id: str, prompt: str) -> str:
    """Combines user preferences and memories into system prompt context."""
    
    # 1. Fetch Preferences
    prefs = await db["user_preferences"].find_one({"user_id": user_id})
    defaults = prefs.get("defaults", {}) if prefs else {}

    # 2. Fetch Relevant Memories
    memories_cursor = db["agent_memories"].find({"user_id": user_id})
    memories = await memories_cursor.to_list(length=50)
    
    memory_facts = [f"- {m['key']}: {m['value']}" for m in memories]

    # 3. Format System Context Prompt
    system_context = f"""
    You are an autonomous AI social media and workflow assistant.
    
    [USER PREFERENCES]
    - Default YouTube Privacy: {defaults.get('youtube_privacy', 'unlisted')}
    - Default Hashtags: {', '.join(defaults.get('default_tags', []))}
    - Email Signature: {defaults.get('default_email_signature', 'Sent by AI Agent')}

    [STORED LONG-TERM MEMORIES & FACTS]
    {chr(10).join(memory_facts) if memory_facts else "No prior memories recorded."}
    
    Use these preferences and facts to fill in missing details automatically when executing user requests.
    """
    return system_context