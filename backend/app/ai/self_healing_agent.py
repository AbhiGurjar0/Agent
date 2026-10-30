# app/ai/self_healing_agent.py
import asyncio
import base64
import io
import os
from pathlib import Path
from PIL import Image

from app.schemas.healing_schema import HealingStrategy
from app.tools.browser_tool import execute_browser_automation
from app.tools.gui_tool import handle_gui_action
from app.client_mic import capture_active_screen
from app.tools.vision_tool import find_element_on_screen

# Import your custom model client and config
from app.ai.openai import get_async_openai_client
from app.ai.config import config

SAFE_WORKSPACE = Path("./workspace").resolve()

class SelfHealingReActEngine:
    def __init__(self, max_retries: int = 3):
        self.max_retries = max_retries

    async def _diagnose_failure(
        self, 
        screenshot_path: Path, 
        failed_action: dict, 
        error_message: str
    ) -> HealingStrategy:
        """Sends screenshot and error context to GPT-4o Vision to determine recovery strategy."""
        
        with open(screenshot_path, "rb") as img_file:
            base64_img = base64.b64encode(img_file.read()).decode("utf-8")

        prompt = f"""
        You are a self-healing web and GUI automation agent.
        An automated action just failed with this error:
        Failed Action: {failed_action}
        Error Message: {error_message}

        Analyze the screenshot carefully:
1. Check if a cookie banner, modal popup, newsletter overlay, or CAPTCHA is blocking the screen.
        2. If a popup is blocking, identify the X/Y coordinates of its close button or 'Accept All' button.
        3. If no popup exists but the selector was missing, suggest a visible text label or alternative element position.
        """

        try:
            # Use your custom model client
            client = get_async_openai_client()
            
            response = await client.beta.chat.completions.parse(
                model=config.azure_openai_deployment or "gpt-4o",  # Fallback to your defined model
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{base64_img}",
                                    "detail": "high"
                                }
                            }
                        ]
                    }
                ],
                response_format=HealingStrategy,
                max_tokens=300
            )
            return response.choices[0].message.parsed
        except Exception as e:
            # Safe fallback diagnosis if Vision API fails
            return HealingStrategy(
                blocker_detected=False,
                suggested_remedy="ABORT_TO_HUMAN",
                explanation=f"Vision diagnosis failed: {str(e)}"
            )

    async def run_browser_action_with_healing(
        self, 
        actions: list, 
        session_id: str = "default"
    ) -> dict:
        """
        Executes Playwright browser actions. If an action fails, activates visual 
        self-healing to dismiss popups or fall back to PyAutoGUI clicks.
        """
        for attempt in range(1, self.max_retries + 1):
            print(f"🔄 Executing browser pipeline (Attempt {attempt}/{self.max_retries})...")
            
            result = await execute_browser_automation(actions=actions, session_id=session_id)
            
            # Check if execution succeeded without errors
            logs = result.get("log", [])
            has_error = any(isinstance(item, dict) and "error" in item for item in logs)
            
            if not has_error and result.get("status") == "completed":
                print("✅ Browser action succeeded!")
                return result

            # Extract error details
            error_details = next((item["error"] for item in logs if isinstance(item, dict) and "error" in item), "Unknown error")
            print(f"⚠️ Action failed on attempt {attempt}: {error_details}")

            if attempt == self.max_retries:
                return {
                    "status": "failed",
                    "error": f"Max retries ({self.max_retries}) reached. Final error: {error_details}",
                    "log": logs
                }

            # --- HEALING PHASE ---
            print("🩹 Initiating Self-Healing Visual Diagnostics...")
            screenshot_path = capture_active_screen() or (SAFE_WORKSPACE / "active_screen.jpg")
            
            # 1. Run Vision Diagnosis
            failed_step = next((actions[i] for i, item in enumerate(logs) if isinstance(item, dict) and "error" in item), actions[-1])
            diagnosis = await self._diagnose_failure(
                screenshot_path=screenshot_path,
                failed_action=failed_step,
                error_message=error_details
            )

            print(f"🩺 Diagnosis: {diagnosis.explanation} (Remedy: {diagnosis.suggested_remedy})")

            # 2. Apply Recovery Strategy
            if diagnosis.suggested_remedy == "CLOSE_OVERLAY" and diagnosis.overlay_close_x and diagnosis.overlay_close_y:
                print(f"🖱️ Self-Healing: Dismissing popup at ({diagnosis.overlay_close_x}, {diagnosis.overlay_close_y})...")
                handle_gui_action(
                    action="click", 
                    x=diagnosis.overlay_close_x, 
                    y=diagnosis.overlay_close_y
                )
                await asyncio.sleep(1.0)  # Wait for overlay fade out

            elif diagnosis.suggested_remedy == "VISION_CLICK":
                # Fall back to visual element search + PyAutoGUI click
                target_desc = diagnosis.alternative_selector_or_text or failed_step.get("selector", "target element")
                print(f"👁️ Self-Healing: Searching visually for '{target_desc}'...")
                coords = await find_element_on_screen(str(screenshot_path), target_desc)
                
                if coords.get("status") == "success":
                    handle_gui_action(
                        action="click", 
                        x=coords["x"], 
                        y=coords["y"]
                    )
                    await asyncio.sleep(1.0)

            elif diagnosis.suggested_remedy == "ABORT_TO_HUMAN":
                print("🛑 Unrecoverable blocker detected (e.g. CAPTCHA). Aborting to human.")
                return {
                    "status": "blocked",
                    "error": f"Self-healing aborted: {diagnosis.explanation}",
                    "requires_human": True
                }

            elif diagnosis.suggested_remedy == "WAIT_AND_RETRY":
                await asyncio.sleep(2.0)

        return {"status": "failed", "error": "Self-healing loop exhausted."}