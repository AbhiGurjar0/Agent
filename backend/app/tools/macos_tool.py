# app/tools/macos_tool.py
import asyncio
import subprocess
from typing import Dict, Any, Optional


async def run_osascript(script: str) -> Dict[str, Any]:
    """Executes an AppleScript string via subprocess asynchronously."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode == 0:
            return {"status": "success", "output": stdout.decode("utf-8").strip()}
        else:
            return {"status": "error", "error": stderr.decode("utf-8").strip()}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def native_click_ui_element(app_name: str, element_type: str, element_name: str) -> Dict[str, Any]:
    """
    Clicks a native macOS UI element by its visual label.
    Example: app_name="Finder", element_type="button", element_name="Applications"
    """
    script = f'''
    tell application "System Events"
        tell process "{app_name}"
            set frontmost to true
            click ({element_type} whose name is "{element_name}") of window 1
        end tell
    end tell
    '''
    return await run_osascript(script)


async def native_select_menu_item(app_name: str, menu_name: str, item_name: str) -> Dict[str, Any]:
    """
    Triggers a menu item directly from the macOS top menu bar.
    Example: app_name="Xcode", menu_name="Product", item_name="Run"
    """
    script = f'''
    tell application "System Events"
        tell process "{app_name}"
            set frontmost to true
            click menu item "{item_name}" of menu "{menu_name}" of menu bar 1
        end tell
    end tell
    '''
    return await run_osascript(script)


async def native_activate_and_type(app_name: str, text_to_type: str) -> Dict[str, Any]:
    """Brings an application to focus and sends raw keystrokes natively."""
    # Escape quotes for AppleScript compatibility
    safe_text = text_to_type.replace('"', '\\"')
    script = f'''
    tell application "{app_name}" to activate
    delay 0.05
    tell application "System Events"
        keystroke "{safe_text}"
    end tell
    '''
    return await run_osascript(script)


async def inspect_active_app_ui_tree(app_name: str) -> Dict[str, Any]:
    """
    Returns a list of all clickable buttons, text fields, and UI elements
    in the active window without taking a screenshot.
    """
    script = f'''
    tell application "System Events"
        tell process "{app_name}"
            set ui_names to name of UI elements of window 1
            return ui_names
        end tell
    end tell
    '''
    return await run_osascript(script)