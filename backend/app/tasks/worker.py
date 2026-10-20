# app/tasks/worker.py
import asyncio
import json
import redis
from celery import Celery
from app.services.youtube_tool import upload_youtube_video
from app.services.insta_tool import upload_instagram_reel
from app.services.facebook_tool import upload_facebook_video
from app.services.email_tool import send_email_message

celery_app = Celery(
    "tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/0"
)

# Synchronous Redis client for publishing notifications from Celery workers
redis_client = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)

def run_async(coro):
    """Helper to run async service logic inside standard Celery sync workers."""
    return asyncio.run(coro)

@celery_app.task(name="tasks.process_tool_execution")
def process_tool_execution(tool_name: str, arguments: dict):
    """Executes heavy social media and email tools via background Celery queue and notifies user."""
    print(f"Step9: Processing tool '{tool_name}' in Celery worker with arguments: {arguments}")
    
    user_id = arguments.get("user_id", "6ac1156aa1165fa861cc5aa0")
    tool_display_name = tool_name.replace('_', ' ')

    try:
        if tool_name == "upload_youtube_video":
            result = run_async(upload_youtube_video(**arguments))
        elif tool_name == "upload_instagram_reel":
            result = run_async(upload_instagram_reel(**arguments))
        elif tool_name == "upload_facebook_video":
            result = run_async(upload_facebook_video(**arguments))
        elif tool_name == "send_email_message":
            result = run_async(send_email_message(**arguments))
        else:
            return {"status": "error", "message": f"Unknown background task: {tool_name}"}

        # Publish success notification to Redis channel
        success_msg = f"Your background task, {tool_display_name}, has completed successfully."
        redis_client.publish(
            f"jarvis_notifications:{user_id}",
            json.dumps({"status": "success", "message": success_msg})
        )
        return result

    except Exception as e:
        # Publish error notification to Redis channel
        error_msg = f"Warning. Your background task, {tool_display_name}, failed to complete."
        redis_client.publish(
            f"jarvis_notifications:{user_id}",
            json.dumps({"status": "error", "message": error_msg})
        )
        raise e