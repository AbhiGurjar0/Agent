# app/ai/dispatcher.py
import asyncio
from pathlib import Path
from app.tools.local_tools import (
    run_terminal_command, 
    manage_local_files, 
    handle_gui_action, 
    take_screenshot
)
from app.tasks.worker import process_tool_execution
from app.tools.system_control import set_volume, launch_app
from app.tools.search_tool import search_web
from app.services.db_journal import DatabaseJournal
from app.tools.browser_tool import execute_browser_automation
from app.tools.vision_tool import find_element_on_screen

SAFE_WORKSPACE = Path("./workspace").resolve()

# Tools that require background queueing
ASYNC_QUEUED_TOOLS = {
    "upload_youtube_video",
    "upload_instagram_reel",
    "upload_facebook_video",
    "send_email_message",
}

async def execute_agent_tool(
    tool_name: str, 
    arguments: dict, 
    user_id: str = None, 
    db = None, 
    chat_id = None,
    notify_callback = None
) -> dict:
    """
    Dynamically routes LLM function calls to background Celery queue, database journal, or direct handlers.
    """
    # Enforce user context if needed by tool
    if user_id and "user_id" not in arguments:
        arguments["user_id"] = user_id

    # 1. Handle Task Revocation / Rollback
    if tool_name == "revoke_task":
        if not db:
            return {"status": "error", "message": "Database session required for task revocation."}
            
        journal = DatabaseJournal(db)
        task_id = arguments.get("task_id")
        target_tool = arguments.get("tool_name")
        
        rollback_result = await journal.rollback_task(
            user_id=user_id,
            task_id=task_id,
            tool_name=target_tool
        )
        return {"status": "success", "result": rollback_result}

    if tool_name == "run_heavy_terminal_script":
        command = arguments.get("command")
        
        async def _background_worker():
            # Await the actual heavy operation
            output = await run_terminal_command(command, user_id, db, chat_id)
            
            # Fire the TTS voice alert back to the WebSocket client
            if notify_callback:
                app_name = command.split()[0] if command else "process"
                if output.get("status") == "success":
                    await notify_callback(f"Background execution of {app_name} has completed successfully.")
                else:
                    await notify_callback(f"Warning: Background task {app_name} failed to execute.")

        # Detach task so the LLM pipeline finishes and frees the microphone immediately
        asyncio.create_task(_background_worker())
        
        return {
            "status": "success", 
            "message": "Task started in the background. I will notify you when it finishes."
        }
    # 2. Queue long-running tasks into Celery worker
    if tool_name in ASYNC_QUEUED_TOOLS:
        task = process_tool_execution.delay(tool_name, arguments)
        print(f"Step8: Dispatched tool '{tool_name}' to Celery queue with task ID: {task.id}")
        return {
            "status": "queued",
            "task_id": task.id,
            "message": f"Task '{tool_name}' dispatched to Celery background queue."
        }

    # 3. Handle fast direct memory & database tools inline
    elif tool_name == "save_memory":
        print(f"Step8: Saving memory for user_id: {user_id}")   
        return {"status": "success", "message": f"Memory saved: {arguments}"}

    elif tool_name == "search_memory":
        print(f"Step8: Searching memory for user_id: {user_id}")
        return {"status": "success", "memory": f"Retrieved facts for query: {arguments}"}

    elif tool_name == "run_terminal_command":
        print(f"Step8: Running local terminal command for user_id: {user_id}")
        # Await async local_tools function and pass journal context
        output = await run_terminal_command(
            command=arguments.get("command"),
            user_id=user_id,
            db=db,
            chat_id=chat_id
        )
        return {"status": "success", "output": output}

    elif tool_name == "manage_local_files":
        print(f"Step8: Managing local files for user_id: {user_id}")
        # Await async local_tools function and pass journal context
        output = await manage_local_files(
            action=arguments.get("action"), 
            file_path=arguments.get("file_path"), 
            destination=arguments.get("destination"),
            new_name=arguments.get("new_name"),
            content=arguments.get("content"),
            user_id=user_id,
            db=db,
            chat_id=chat_id
        )
        return {"status": "success", "output": output}

    elif tool_name == "search_web":
        print(f"Step8: Executing web search for query: {arguments.get('query')}")
        output = search_web(query=arguments.get("query"))
        return {"status": "success", "results": output}

    elif tool_name == "take_screenshot":
        print(f"Step8: Taking desktop screenshot for visual analysis, user_id: {user_id}")
        output = take_screenshot()
        return {"status": "success", "output": output}

    elif tool_name == "handle_gui_action":
        print(f"Step8: Interacting with application for user_id: {user_id}")
        output = handle_gui_action(
            action=arguments.get("action"), 
            text=arguments.get("text"), 
            x=arguments.get("x"),
            y=arguments.get("y"),
            key=arguments.get("key")
        )
        return {"status": "success", "output": output}

    elif tool_name == "set_volume":
        print(f"Step8: Adjusting macOS volume for user_id: {user_id}")
        output = set_volume(level=arguments.get("level", 50))
        return {"status": "success", "output": output}

    elif tool_name == "launch_app":
        print(f"Step8: Opening app '{arguments.get('app_name')}' for user_id: {user_id}")
        output = launch_app(app_name=arguments.get("app_name"))
        return {"status": "success", "output": output}
    elif tool_name == "execute_browser_automation":
        print(f"Step8: Running dynamic browser automation for user_id: {user_id}")
        
        # We await the async playwright function directly
        output = await execute_browser_automation(
            actions=arguments.get("actions", [])
        )
        return {"status": "success", "output": output}
    elif tool_name == "find_element_coordinates":
        print(f"Step 10: Extracting screen coordinates for: {arguments.get('element_description')}")
        
        # Verify a screenshot exists
        screenshot_path = SAFE_WORKSPACE / "active_screen.jpg"
        if not screenshot_path.exists():
            return {"status": "error", "error": "No screenshot found. Please run take_screenshot first."}
            
        output = await find_element_on_screen(
            image_path=str(screenshot_path),
            element_description=arguments.get("element_description")
        )
        return {"status": "success", "output": output}

    else:
        return {"status": "error", "message": f"Unknown tool: {tool_name}"}