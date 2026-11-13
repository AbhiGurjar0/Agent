import time
import subprocess

def get_retina_scale_factor() -> float:
    """
    Returns the display scale factor for macOS Retina displays.
    Returns 2.0 on Retina displays, 1.0 on non-Retina displays.
    """
    try:
        output = subprocess.check_output(
            "system_profiler SPDisplaysDataType | grep -i 'retina'", 
            shell=True, 
            text=True
        )
        if "retina" in output.lower():
            return 2.0
    except Exception:
        pass
    
    return 1.0


def handle_gui_action(
    action: str, 
    text: str = None, 
    x: int = None, 
    y: int = None, 
    key: str = None
) -> str:
    """Simulates mouse clicks, typing, and keypresses on the desktop with scale correction."""
    try:
        import pyautogui
        time.sleep(0.5)
        scale_factor = get_retina_scale_factor()

        if action == "click":
            if x is not None and y is not None:
                # Convert physical screenshot pixels to logical screen coordinates
                logical_x = int(x / scale_factor)
                logical_y = int(y / scale_factor)
                pyautogui.click(x=logical_x, y=logical_y)
                return f"Successfully clicked at coordinates ({x}, {y}) [scaled to ({logical_x}, {logical_y})]."
            else:
                pyautogui.click()
                return "Clicked at current mouse position."
                
        elif action == "type":
            if not text:
                return "Error: No text provided to type."
            pyautogui.write(text, interval=0.05)
            return f"Successfully typed text: '{text}'"
            
        elif action == "press":
            target_key = key or text
            if not target_key:
                return "Error: No key specified to press."
            pyautogui.press(target_key)
            return f"Pressed key: {target_key}"
            
        elif action == "hotkey":
            if text:
                keys = [k.strip() for k in text.split("+")]
            elif key:
                keys = [key]
            else:
                return "Error: No keys specified for shortcut."
                
            pyautogui.hotkey(*keys)
            return f"Triggered shortcut combination: {' + '.join(keys)}"
            
        return "Invalid GUI action specified."
    except Exception as e:
        return f"GUI automation error: {str(e)}"