import asyncio
import json
import re
from typing import Any, List, Optional, Tuple
from urllib.parse import urlparse
from openai import AsyncOpenAI, AsyncAzureOpenAI
from openai import AsyncOpenAI
from sentence_transformers import SentenceTransformer
from app.ai.config import config
from app.db.database import get_database
from app.db.memory_doc import agent_memory_document


db = get_database()
embedding_model = SentenceTransformer("BAAI/bge-small-en-v1.5")


async def get_text_embedding(text: str) -> list[float]:
    """Generates a 384-dimensional vector embedding locally using HuggingFace BGE."""
    if not text or not text.strip():
        return []

    # Run in a thread pool to keep FastAPI event loop async and fast
    embedding = await asyncio.to_thread(
        embedding_model.encode, 
        text, 
        normalize_embeddings=True
    )
    
    return embedding.tolist()


def get_async_openai_client():
    """Returns an asynchronous OpenAI or Azure OpenAI client."""
    if config.azure_openai_endpoint and config.azure_openai_api_key:
        raw_endpoint = config.azure_openai_endpoint.strip()

        # Azure AI Foundry / Azure OpenAI v1 endpoint format
        if "/openai/v1" in raw_endpoint:
            base_url = re.sub(r"/responses$", "", raw_endpoint).rstrip("/")
            return AsyncOpenAI(
                base_url=base_url,
                api_key=config.azure_openai_api_key,
                default_headers={"api-key": config.azure_openai_api_key},
            )

        # Classic Azure OpenAI client
        try:
            parsed = urlparse(raw_endpoint)
            cleaned_endpoint = (
                f"{parsed.scheme}://{parsed.netloc}"
                if parsed.scheme and parsed.netloc
                else raw_endpoint.rstrip("/")
            )
        except Exception:
            cleaned_endpoint = raw_endpoint.rstrip("/")

        return AsyncAzureOpenAI(
            azure_endpoint=cleaned_endpoint,
            api_key=config.azure_openai_api_key,
            api_version=config.azure_openai_api_version,
            azure_deployment=config.azure_openai_deployment,
        )

    return AsyncOpenAI(api_key=config.openai_api_key)


def _get_role_and_content(message: Any) -> Tuple[Optional[str], str]:
    """
    Safely retrieves 'role' and 'content' whether the message is a dict
    or an OpenAI Pydantic object (e.g., ChatCompletionMessage).
    """
    if isinstance(message, dict):
        role = message.get("role")
        content = message.get("content") or ""
    else:
        role = getattr(message, "role", None)
        content = getattr(message, "content", "") or ""

    return role, content


async def extract_and_store_facts(user_id: str, conversation_turn: str):
    """
    Analyzes the latest user/assistant interaction turn in the background
    to extract new personal facts, preferences, or activities and updates MongoDB.
    """
    if not user_id or not conversation_turn.strip():
        return

    try:
        client = get_async_openai_client()
        extraction_prompt = f"""
Analyze the following conversation turn. 
Extract long-term user details (e.g., location, email, default file paths).
DO NOT extract one-off action commands as permanent "only" preferences unless explicitly instructed by the user (e.g., "Always upload to YouTube only from now on").

        Conversation Turn:
        "{conversation_turn}"

        Respond ONLY in valid JSON format with a list of key-value objects:
        {{
            "facts": [
                {{"key": "location", "value": "Bikaner"}},
                {{"key": "current_project", "value": "FastAPI AI agent"}}
            ]
        }}
        If no personal facts, user details, or preferences were stated, return {{"facts": []}}.
        """

        kwargs = {
            "model": config.azure_openai_deployment or "gpt-4o-mini",
            "messages": [{"role": "user", "content": extraction_prompt}],
            "response_format": {"type": "json_object"},
        }

        response = await client.chat.completions.create(**kwargs)
        raw_content = response.choices[0].message.content
        data = json.loads(raw_content)
        facts = data.get("facts", [])
        print(f"[Memory Extractor] Extracted facts for user {user_id}: {facts}")

        # Upsert extracted facts into MongoDB
        for fact in facts:
            key = fact.get("key")
            value = fact.get("value")
            if key and value:
                # Create a vector embedding of the fact itself
                fact_text = f"{key}: {value}"
                fact_embedding = await get_text_embedding(fact_text)
                
                doc = agent_memory_document(
                    user_id=user_id, key=key, value=value, memory_type="fact"
                )
                doc["embeddings"] = fact_embedding  # Attach the vector data
                
                await db["agent_memories"].update_one(
                    {"user_id": user_id, "key": key}, {"$set": doc}, upsert=True
                )
        print("Step5: Extracted preferences And Stored in db with user_id:", user_id)
    except Exception as e:
        # Logging error without crashing main API thread
        print(f"[Memory Extractor Warning] Failed to extract memory facts: {str(e)}")


async def call_model(
    messages: List[Any],
    tools: Optional[List[dict]] = None,
    max_tokens: int = 1000,
    label: str = "default",
    user_id: Optional[str] = None,
) -> Any:
    """Executes an async OpenAI completion call supporting native tool calling and background memory extraction."""
    client = get_async_openai_client()

    kwargs = {
        "model": config.azure_openai_deployment or "gpt-4o",
        "messages": messages,
        "max_completion_tokens": max_tokens,  # Updated from max_tokens
    }

    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"

    response = await client.chat.completions.create(**kwargs)

    print("Step3:Model Called with user_id:", user_id)

    # Automatically trigger fact extraction in the background if user_id is provided
    if user_id and response.choices and len(response.choices) > 0:
        assistant_reply = response.choices[0].message.content or ""

        # Safely capture last user prompt regardless of whether messages contains dicts or Pydantic models
        last_user_message = ""
        for m in reversed(messages):
            role, content = _get_role_and_content(m)
            if role == "user":
                last_user_message = content
                break

        turn_text = f"User: {last_user_message}\nAssistant: {assistant_reply}"

        print("Step4:Storing the preferences with user_id:", user_id)
        # Fire non-blocking background task
        asyncio.create_task(
            extract_and_store_facts(user_id=user_id, conversation_turn=turn_text)
        )

    return response


