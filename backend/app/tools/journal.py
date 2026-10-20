# app/tools/journal.py
import os
import shutil
import subprocess
import logging

logger = logging.getLogger("jarvis.journal")

class ExecutionJournal:
    def __init__(self):
        self.history = []  # List of recorded tasks with rollback handlers

    def record(self, tool_name: str, args: dict, rollback_data: dict):
        """Records a successful tool execution with instructions on how to undo it."""
        entry = {
            "id": len(self.history) + 1,
            "tool_name": tool_name,
            "args": args,
            "rollback_data": rollback_data,
        }
        self.history.append(entry)
        logger.info(f"Journaled action #{entry['id']}: {tool_name}")
        return entry["id"]

    async def rollback_specific(self, task_id: int = None, tool_name: str = None) -> str:
        """Rolls back either a specific task ID or the most recent action matching tool_name."""
        if not self.history:
            return "No recorded actions to undo."

        target_idx = None
        if task_id is not None:
            for i, entry in enumerate(self.history):
                if entry["id"] == task_id:
                    target_idx = i
                    break
        elif tool_name is not None:
            for i in range(len(self.history) - 1, -1, -1):
                if self.history[i]["tool_name"] == tool_name:
                    target_idx = i
                    break
        else:
            target_idx = len(self.history) - 1  # Undo most recent action

        if target_idx is None:
            return "Matching task for rollback not found."

        entry = self.history.pop(target_idx)
        return await self._execute_rollback(entry)

    async def _execute_rollback(self, entry: dict) -> str:
        tool_name = entry["tool_name"]
        rb_data = entry["rollback_data"]

        try:
            if tool_name == "manage_local_files":
                action = rb_data.get("action")
                path = rb_data.get("path")
                if action == "delete_created_file" and os.path.exists(path):
                    os.remove(path)
                    return f"Successfully reverted file creation: deleted {path}"
                elif action == "restore_backup" and os.path.exists(rb_data.get("backup_path")):
                    shutil.copy(rb_data["backup_path"], path)
                    os.remove(rb_data["backup_path"])
                    return f"Successfully restored previous content for {path}"

            elif tool_name == "run_terminal_command":
                pid = rb_data.get("pid")
                if pid:
                    subprocess.run(["kill", "-9", str(pid)], check=False)
                    return f"Terminated background shell process (PID {pid})"

            return f"Reverted side effects for {tool_name}."
        except Exception as e:
            return f"Rollback failed for {tool_name}: {str(e)}"

# Global session instance
global_journal = ExecutionJournal()