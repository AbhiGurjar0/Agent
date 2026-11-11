# app/ai/direct_first.py
"""Direct-tools-first routing helpers used by run_chat_pipeline / _react_loop."""
from typing import Any, Dict, List

# Tools the model may call directly. Everything else (browser, GUI, vision, screenshots,
# AppleScript, coding, terminal, multi-step work) goes to the DAG planner.
# run_terminal_command is deliberately NOT here; add it if you want shell tasks to stay direct.
DIRECT_TOOLS = {
    "save_memory", "search_memory",
    "create_task", "create_reminder",
    "upload_youtube_video", "upload_instagram_reel", "upload_facebook_video",
    "send_email_message",
    "manage_local_files", "set_volume", "launch_app",
    "native_macos_action", "revoke_task",
    "search_web",
}

ESCALATE_NAME = "escalate_to_planner"
ESCALATE = object()  # sentinel returned by _react_loop when the planner should take over

ESCALATE_TOOL: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": ESCALATE_NAME,
        "description": (
            "Call this when NONE of the other tools can fully do the user's request, or it needs "
            "web browsing / YouTube / music playback, desktop clicking, AppleScript, writing or "
            "running code, scraping, comparing data, or several dependent steps."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}

ROUTING_NOTE = (
    "ROUTING RULES: If one of the provided tools fully satisfies the request, call it with "
    "correct arguments. Never guess required arguments (emails, paths); ask the user instead. "
    "If the message is plain conversation or a general question, just answer in text. "
    f"If it is an action request that no provided tool can do, call {ESCALATE_NAME}. "
    "Never say you cannot do something without calling it first."
    " For any question needing current or factual web information (news, prices, box office, "
    "scores, dates), call search_web instead of escalating."
)


def select_direct_tools(tool_router, user_message: str, limit: int = 6) -> List[Dict[str, Any]]:
    """Semantic top-k from your DynamicToolRouter, filtered to the direct-tool whitelist."""
    picked = tool_router.select_tools(user_message, top_k=12) or []
    direct = [t for t in picked if t.get("function", {}).get("name") in DIRECT_TOOLS]
    return direct[:limit]