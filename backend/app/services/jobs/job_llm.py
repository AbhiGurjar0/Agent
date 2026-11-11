# app/services/job_llm.py
"""Tiny structured-output helper shared by job intake and the validator."""
import asyncio
from typing import Any, Dict, List, Type, TypeVar

from pydantic import BaseModel

from app.ai.config import config
from app.ai.openai import get_async_openai_client

T = TypeVar("T", bound=BaseModel)


async def parse(messages: List[Dict[str, Any]], schema: Type[T], attempts: int = 2, timeout: float = 45.0) -> T:
    client = get_async_openai_client()
    model = config.azure_openai_deployment or "gpt-4o"
    last: Exception | None = None
    for _ in range(attempts):
        try:
            r = await asyncio.wait_for(
                client.beta.chat.completions.parse(model=model, messages=messages, response_format=schema),
                timeout=timeout,
            )
            m = r.choices[0].message
            if getattr(m, "refusal", None):
                raise RuntimeError(f"model refused: {m.refusal}")
            if m.parsed is None:
                raise ValueError("model returned no parsable output")
            return m.parsed
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"LLM parse failed: {last}")