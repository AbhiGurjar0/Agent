# app/ai/approval_manager.py
import asyncio
import uuid
from typing import Dict, Any, Optional

class ApprovalManager:
    def __init__(self):
        # Maps approval_id -> {"event": asyncio.Event, "approved": bool, "details": dict}
        self._pending_approvals: Dict[str, Dict[str, Any]] = {}

    async def request_approval(
        self, 
        user_id: str, 
        tool_name: str, 
        arguments: dict, 
        notify_callback=None, 
        timeout_sec: float = 30.0
    ) -> bool:
        """
        Pauses tool execution and waits for human confirmation via UI or voice command.
        """
        approval_id = str(uuid.uuid4())[:8]
        event = asyncio.Event()

        self._pending_approvals[approval_id] = {
            "event": event,
            "approved": False,
            "user_id": user_id,
            "tool_name": tool_name,
            "arguments": arguments,
        }

        # Human-readable summary for voice/UI notification
        summary = f"I need your approval to execute '{tool_name}'."
        if tool_name == "handle_gui_action" and arguments.get("text"):
            summary = f"Approval needed: Type or execute '{arguments.get('text')}'."
        elif tool_name == "delete_file":
            summary = f"Approval needed: Delete file '{arguments.get('file_path')}'."

        print(f"🔒 [HITL Gate] Created approval request [{approval_id}] for user {user_id}: {summary}")

        # Send voice/WebSocket notification
        if notify_callback:
            await notify_callback(summary)

        try:
            # Wait for user resolution or timeout
            await asyncio.wait_for(event.wait(), timeout=timeout_sec)
            is_approved = self._pending_approvals[approval_id]["approved"]
            return is_approved
        except asyncio.TimeoutError:
            print(f"⏰ [HITL Gate] Approval request [{approval_id}] timed out after {timeout_sec}s.")
            return False
        finally:
            self._pending_approvals.pop(approval_id, None)

    def resolve_approval(self, approval_id: str, approved: bool) -> bool:
        """Resolves a pending approval when user confirms via REST or WebSocket."""
        if approval_id in self._pending_approvals:
            record = self._pending_approvals[approval_id]
            record["approved"] = approved
            record["event"].set()  # Unblocks the waiting tool execution
            return True
        return False

# Global singleton instance
approval_manager = ApprovalManager()