import subprocess
from pathlib import Path

SAFE_WORKSPACE = Path("./workspace").resolve()
SAFE_WORKSPACE.mkdir(parents=True, exist_ok=True)

def capture_active_screen():
    """Takes a quick, compressed screenshot of the primary display (macOS only)."""
    screenshot_path = SAFE_WORKSPACE / "active_screen.jpg"
    try:
        subprocess.run(["screencapture", "-x", "-t", "jpg", str(screenshot_path)], check=False)
    except FileNotFoundError:
        return None  # not on macOS (e.g. Render)
    return screenshot_path if screenshot_path.exists() else None