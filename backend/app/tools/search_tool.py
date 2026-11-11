import os
from tavily import TavilyClient
from app.core.config import settings

tavily_client = TavilyClient(api_key=settings.tavily_api_key)


def search_web(query: str, max_results: int = 5) -> str:
    """Live web search via Tavily: synthesized answer + per-source snippets (with dates when available)."""
    try:
        resp = tavily_client.search(
            query=query,
            max_results=max(1, min(int(max_results), 8)),
            include_answer=True,
            search_depth="advanced",
        )
    except Exception as e:
        return f"Web search failed: {e}"

    parts = []
    if resp.get("answer"):
        parts.append(f"Answer: {resp['answer']}")
    for r in resp.get("results", []):
        date = r.get("published_date") or ""
        parts.append(
            f"- {r.get('title','')} {('(' + date + ')') if date else ''}\n"
            f"  {r.get('url','')}\n  {(r.get('content') or '')[:500]}"
        )
    return "\n\n".join(parts) if parts else "No relevant search results found."