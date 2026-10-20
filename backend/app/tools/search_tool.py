# app/tools/search_tool.py
import os
from tavily import TavilyClient
from app.core.config import settings

# Initialize Tavily client using your config key
tavily_client = TavilyClient(api_key=settings.tavily_api_key)

def search_web(query: str, max_results: int = 3) -> str:
    """Performs a live web search using Tavily API and returns summarized results."""
    try:
        response = tavily_client.search(
            query=query, 
            max_results=max_results,
            include_answer=True # Tavily provides a direct synthesized AI answer
        )
        
        # If Tavily synthesized a direct answer, return it
        if "answer" in response and response["answer"]:
            summary = response["answer"]
            sources = [result["url"] for result in response.get("results", [])]
            return f"Answer: {summary}\n\nSources: {sources}"
            
        # Otherwise, format the raw search results
        results = response.get("results", [])
        formatted = "\n\n".join([f"Title: {r['title']}\nURL: {r['url']}\nContent: {r['content']}" for r in results])
        return formatted if formatted else "No relevant search results found."
        
    except Exception as e:
        return f"Web search failed: {str(e)}"