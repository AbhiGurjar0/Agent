# app/tools/local_tools.py
import os
import platform
import subprocess
import shutil
from pathlib import Path
import time
from datetime import datetime

SAFE_WORKSPACE = Path("./workspace").resolve()
SAFE_WORKSPACE.mkdir(exist_ok=True)


def take_screenshot() -> str:
    """Takes a screenshot of the current desktop and saves it to the workspace."""
    try:
        import pyautogui
    except Exception as e:
        return f"Screenshot unavailable on this server: {e}"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"screenshot_{timestamp}.png"
    screenshot_path = SAFE_WORKSPACE / filename
    screenshot = pyautogui.screenshot()
    screenshot.save(screenshot_path)
    return f"Screenshot saved to {screenshot_path}. You can now analyze the screen state."

def handle_gui_action(action: str, text: str = None, x: int = None, y: int = None, key: str = None) -> str:
    """Simulates mouse clicks, typing, and keypresses on the desktop."""
    try:
        import pyautogui
        pyautogui.FAILSAFE = True
        time.sleep(0.5)
        if action == "click":
            if x is not None and y is not None:
                pyautogui.click(x=x, y=y)
                return f"Successfully clicked at screen coordinates ({x}, {y})."
            else:
                pyautogui.click()
                return "Clicked at current mouse position."
                
        elif action == "type":
            if not text:
                return "Error: No text provided to type."
            pyautogui.write(text, interval=0.05)
            return f"Successfully typed text: '{text}'"
            
        elif action == "press":
            if not key:
                return "Error: No key specified."
            pyautogui.press(key)
            return f"Pressed key: {key}"
            
        elif action == "hotkey":
            keys = text.split("+") if text else [key]
            pyautogui.hotkey(*keys)
            return f"Triggered shortcut combination: {keys}"
            
        return "Invalid GUI action specified."
    except Exception as e:
        return f"GUI automation error: {str(e)}"

# =====================================================================
# JOURNAL-AWARE TOOL EXECUTIONS
# =====================================================================

async def run_terminal_command(command: str, user_id: str = None, db = None, chat_id = None) -> dict:
    """Runs a safe terminal command inside the workspace directory and records process PID for revocation."""
    try:
        forbidden = ["rm -rf /", "mkfs", "dd"]
        if any(f in command for f in forbidden):
            return {"status": "error", "message": "Command blocked for security reasons."}

        # Spawn non-blocking subprocess so PID can be recorded
        process = subprocess.Popen(
            command,
            shell=True,
            cwd=str(SAFE_WORKSPACE),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        stdout, stderr = process.communicate(timeout=30)
        output = stdout if process.returncode == 0 else stderr

        # Prepare rollback information (Process PID)
        rollback_data = {
            "action": "kill_process",
            "pid": process.pid,
            "command": command
        }

        # Log entry to database if db and chat_id are provided
        task_id = None
        if db is not None and user_id and chat_id:
            from app.services.db_journal import DatabaseJournal
            journal = DatabaseJournal(db)
            task_id = await journal.log_action(
                user_id=user_id,
                chat_id=chat_id,
                tool_name="run_terminal_command",
                args={"command": command},
                rollback_data=rollback_data
            )

        return {
            "status": "success",
            "output": output,
            "task_id": task_id,
            "pid": process.pid
        }
    except subprocess.TimeoutExpired:
        process.kill()
        return {"status": "error", "message": "Terminal command execution timed out after 30s."}
    except Exception as e:
        return {"status": "error", "message": f"Execution failed: {str(e)}"}


async def manage_local_files(
    action: str, 
    file_path: str, 
    destination: str = None, 
    new_name: str = None, 
    content: str = None,
    user_id: str = None,
    db = None,
    chat_id = None
) -> dict:
    """Handles local file management while creating backups for safe revocation."""
    try:
        clean_path = file_path.lstrip("/\\")
        if clean_path.startswith("workspace/"):
            clean_path = clean_path[len("workspace/"):]

        target = (SAFE_WORKSPACE / clean_path).resolve()
        
        if not str(target).startswith(str(SAFE_WORKSPACE)):
            return {"status": "error", "message": "Access denied outside workspace directory."}

        rollback_data = {}

        if action == "list":
            if not target.exists():
                return {"status": "error", "message": f"Directory {file_path} does not exist."}
            files = [str(p.relative_to(SAFE_WORKSPACE)) for p in target.glob("**/*")]
            return {"status": "success", "files": files}

        elif action in ["write", "create"]:
            target.parent.mkdir(parents=True, exist_ok=True)
            file_existed = target.exists()
            backup_path = None

            # Create a temporary backup if overwriting an existing file
            if file_existed:
                backup_path = str(target) + ".bak"
                shutil.copy(str(target), backup_path)

            text_to_write = content or ""
            target.write_text(text_to_write, encoding="utf-8")

            rollback_data = {
                "action": "restore_backup" if file_existed else "delete_created_file",
                "path": str(target),
                "backup_path": backup_path
            }
            msg = f"Successfully wrote content to {file_path}"

        elif action == "delete":
            if not target.exists():
                return {"status": "error", "message": f"File or folder {file_path} does not exist."}

            # Create backup before deleting
            backup_path = str(target) + ".bak"
            if target.is_file():
                shutil.copy(str(target), backup_path)
                target.unlink()
                rollback_data = {"action": "restore_backup", "path": str(target), "backup_path": backup_path}
                msg = f"Successfully deleted file {file_path}"
            elif target.is_dir():
                shutil.copytree(str(target), backup_path)
                shutil.rmtree(str(target))
                rollback_data = {"action": "restore_directory", "path": str(target), "backup_path": backup_path}
                msg = f"Successfully deleted directory {file_path}"

        elif action == "read":
            if not target.exists():
                return {"status": "error", "message": f"File {file_path} does not exist."}
            return {"status": "success", "content": target.read_text(encoding="utf-8")}

        elif action == "open":
            system_name = platform.system()
            if system_name == "Darwin":
                if target.exists():
                    subprocess.run(["open", str(target)], check=True)
                    return {"status": "success", "message": f"Opened file: {file_path}"}
                app_name = file_path.replace(".app", "")
                try:
                    subprocess.run(["open", "-a", app_name], check=True)
                    return {"status": "success", "message": f"Launched macOS application: {app_name}"}
                except Exception:
                    return {"status": "error", "message": f"Could not open file or app '{app_name}'."}
            elif system_name == "Windows":
                os.startfile(str(target))
            else:
                subprocess.run(["xdg-open", str(target)], check=True)
            return {"status": "success", "message": f"Opened {file_path}"}

        else:
            return {"status": "error", "message": "Invalid file action specified."}

        # Save rollback record into MongoDB if session context exists
        task_id = None
        if db is not None and user_id and chat_id and rollback_data:
            from app.services.db_journal import DatabaseJournal
            journal = DatabaseJournal(db)
            task_id = await journal.log_action(
                user_id=user_id,
                chat_id=chat_id,
                tool_name="manage_local_files",
                args={"action": action, "file_path": file_path},
                rollback_data=rollback_data
            )

        return {"status": "success", "message": msg, "task_id": task_id}

    except Exception as e:
        return {"status": "error", "message": f"File operation error: {str(e)}"}