import json
import re
from typing import Any, List, Optional
from urllib.parse import urlparse

from openai import AsyncOpenAI, AsyncAzureOpenAI
from app.ai.config import config





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


async def call_model(
    messages: List[dict],
    tools: Optional[List[dict]] = None,
    max_tokens: int = 1000,
    label: str = "default",
) -> Any:
    """Executes an async OpenAI completion call supporting native tool calling."""
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
    return response