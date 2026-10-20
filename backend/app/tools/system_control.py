# app/tools/system_control.py
import subprocess
import shutil

def run_applescript(script: str) -> str:
    """Helper function to execute inline AppleScript strings."""
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        return f"AppleScript Error: {e.stderr.strip()}"

# ==========================================
# 1. VOLUME CONTROLS
# ==========================================

def set_volume(level: int) -> str:
    """Sets system output volume from 0 to 100."""
    level = max(0, min(100, level))
    script = f"set volume output volume {level}"
    run_applescript(script)
    return f"Volume set to {level}%"

def get_volume() -> str:
    """Gets current output volume percentage."""
    script = "output volume of (get volume settings)"
    vol = run_applescript(script)
    return f"Current volume is {vol}%"

def set_mute(mute: bool = True) -> str:
    """Mutes or unmutes system audio."""
    state = "true" if mute else "false"
    script = f"set volume output muted {state}"
    run_applescript(script)
    return "Audio muted" if mute else "Audio unmuted"

# ==========================================
# 2. DISPLAY BRIGHTNESS CONTROLS
# ==========================================

def adjust_brightness(direction: str = "up", steps: int = 2) -> str:
    """
    Adjusts display brightness up or down using macOS keycodes.
    Keycode 144 = Brightness Up, Keycode 145 = Brightness Down.
    """
    key_code = 144 if direction.lower() == "up" else 145
    script = f'''
    tell application "System Events"
        repeat {steps} times
            key code {key_code}
            delay 0.05
        end repeat
    end tell
    '''
    run_applescript(script)
    return f"Brightness adjusted {direction} by {steps} steps"

def set_exact_brightness(percent: int) -> str:
    """
    Sets exact brightness percentage (Requires `brew install brightness`).
    Falls back to step adjustment if the CLI tool isn't installed.
    """
    if shutil.which("brightness"):
        val = max(0.0, min(1.0, percent / 100.0))
        subprocess.run(["brightness", str(val)], check=False)
        return f"Brightness set to {percent}%"
    else:
        return "Exact percentage requires `brew install brightness`. Use adjust_brightness() instead."

# ==========================================
# 3. APPLICATION CONTROLS
# ==========================================

def launch_app(app_name: str) -> str:
    """Launches or brings an application to the foreground."""
    script = f'tell application "{app_name}" to activate'
    res = run_applescript(script)
    if "Error" in res:
        return f"Failed to open '{app_name}'. Make sure the app name is exact."
    return f"Opened {app_name}"

def quit_app(app_name: str) -> str:
    """Gracefully quits a running application."""
    script = f'tell application "{app_name}" to quit'
    res = run_applescript(script)
    if "Error" in res:
        return f"Could not quit '{app_name}' or it is not running."
    return f"Closed {app_name}"

def get_running_apps() -> list[str]:
    """Returns a list of all visible running applications."""
    script = '''
    tell application "System Events"
        set appList to name of every process whose visible is true
        return appList
    end tell
    '''
    output = run_applescript(script)
    return [app.strip() for app in output.split(",")] if output else []

def get_frontmost_app() -> str:
    """Gets the name of the active frontmost window application."""
    script = '''
    tell application "System Events"
        return name of first application process whose frontmost is true
    end tell
    '''
    return run_applescript(script)