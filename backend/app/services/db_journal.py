# app/services/db_journal.py
import os
import shutil
import subprocess
import logging
from datetime import datetime, timezone

logger = logging.getLogger("jarvis.db_journal")

class DatabaseJournal:
    def __init__(self, db):
        self.db = db

    async def log_action(self, user_id: str, chat_id, tool_name: str, args: dict, rollback_data: dict) -> int:
        """
        Attaches a journaled side-effect entry to a specific chat turn in MongoDB.
        """
        task_id = int(datetime.now(timezone.utc).timestamp() * 1000)  # Unique timestamp-based ID
        
        journal_entry = {
            "task_id": task_id,
            "tool_name": tool_name,
            "args": args,
            "rollback_data": rollback_data,
            "status": "completed",
            "created_at": datetime.now(timezone.utc)
        }

        # Atomically push journal entry into the assistant chat message in DB
        await self.db["chats"].update_one(
            {"_id": chat_id, "user_id": user_id},
            {"$push": {"journal_entries": journal_entry}}
        )
        logger.info(f"💾 Persisted journal action #{task_id} to DB for user={user_id}")
        return task_id

    async def rollback_task(self, user_id: str, task_id: int = None, tool_name: str = None) -> str:
        """
        Finds the journal record in MongoDB, performs physical rollback, and updates DB status.
        """
        query = {"user_id": user_id, "journal_entries.status": "completed"}
        if task_id:
            query["journal_entries.task_id"] = task_id
        elif tool_name:
            query["journal_entries.tool_name"] = tool_name

        # Find the chat document containing the matching active task
        chat_doc = await self.db["chats"].find_one(query, sort=[("created_at", -1)])
        if not chat_doc or "journal_entries" not in chat_doc:
            return "No matching completed action found to revoke."

        # Locate exact entry
        entries = chat_doc["journal_entries"]
        target_entry = None
        for entry in reversed(entries):
            if entry["status"] == "completed":
                if (task_id and entry["task_id"] == task_id) or (tool_name and entry["tool_name"] == tool_name) or (not task_id and not tool_name):
                    target_entry = entry
                    break

        if not target_entry:
            return "No valid action available for rollback."

        # Perform physical side-effect reversion
        rollback_msg = await self._execute_physical_rollback(target_entry)

        # Mark journal entry status as 'revoked' in MongoDB
        await self.db["chats"].update_one(
            {"_id": chat_doc["_id"], "journal_entries.task_id": target_entry["task_id"]},
            {"$set": {"journal_entries.$.status": "revoked"}}
        )

        return f"Revoked Task #{target_entry['task_id']} ({target_entry['tool_name']}): {rollback_msg}"

    async def _execute_physical_rollback(self, entry: dict) -> str:
        tool_name = entry["tool_name"]
        rb_data = entry["rollback_data"]

        try:
            if tool_name == "manage_local_files":
                action = rb_data.get("action")
                path = rb_data.get("path")
                if action == "delete_created_file" and os.path.exists(path):
                    os.remove(path)
                    return f"Deleted file created by task: {path}"
                elif action == "restore_backup" and os.path.exists(rb_data.get("backup_path")):
                    shutil.copy(rb_data["backup_path"], path)
                    os.remove(rb_data["backup_path"])
                    return f"Restored previous version of {path}"

            elif tool_name == "run_terminal_command":
                pid = rb_data.get("pid")
                if pid:
                    subprocess.run(["kill", "-9", str(pid)], check=False)
                    return f"Killed shell process PID {pid}"

            return f"Reverted side effect for {tool_name}."
        except Exception as e:
            return f"Error executing rollback: {str(e)}"