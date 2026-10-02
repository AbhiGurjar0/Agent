import asyncio
from app.core.celery_app import celery
from app.ai.dispatcher import execute_agent_tool

@celery.task(name="execute_background_tool")
def run_background_tool(tool_name: str, arguments: dict):
    """Runs social media uploads asynchronously in the background worker."""
    return asyncio.run(execute_agent_tool(tool_name, arguments))