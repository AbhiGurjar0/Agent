# app/ai/dispatcher.py
from app.services.youtube_upload import upload_youtube_video
from app.services.instagram_tool import upload_instagram_reel
from app.services.facebook_tool import upload_facebook_video
from app.services.email_tool import send_email_message

async def execute_agent_tool(tool_name: str, arguments: dict) -> dict:
    """Dynamically executes the function selected by the LLM."""
    if tool_name == "upload_youtube_video":
        return await upload_youtube_video(**arguments)
    elif tool_name == "upload_instagram_reel":
        return await upload_instagram_reel(**arguments)
    elif tool_name == "upload_facebook_video":
        return await upload_facebook_video(**arguments)
    elif tool_name == "send_email_message":
        return await send_email_message(**arguments)
    else:
        return {"status": "error", "message": f"Unknown tool: {tool_name}"}