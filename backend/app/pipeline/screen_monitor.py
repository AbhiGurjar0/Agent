# app/pipeline/screen_monitor.py
import asyncio
import base64
import io
import json
import os
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
from openai import AsyncOpenAI
import redis.asyncio as aioredis

from app.schemas.vision_schema import ScreenErrorAlert

openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
SAFE_WORKSPACE = Path("./workspace").resolve()
SAFE_WORKSPACE.mkdir(parents=True, exist_ok=True)

class ProactiveScreenMonitor:
    def __init__(
        self, 
        user_id: str = "6ac1156aa1165fa861cc5aa0", 
        check_interval_sec: float = 5.0,
        diff_threshold: float = 3.0
    ):
        self.user_id = user_id
        self.check_interval_sec = check_interval_sec
        self.diff_threshold = diff_threshold
        self.previous_frame: Image.Image | None = None
        self.last_reported_error: str | None = None
        self.is_running = False

    def capture_screen_pil(self) -> Image.Image | None:
        """Captures active macOS screen to PIL Image using native screencapture."""
        temp_path = SAFE_WORKSPACE / "monitor_temp.jpg"
        try:
            subprocess.run(["screencapture", "-x", "-t", "jpg", str(temp_path)], check=True)
            img = Image.open(temp_path).convert("RGB")
            # Downsample slightly to speed up diff and reduce Vision token count
            img.thumbnail((1280, 720))
            return img
        except Exception as e:
            print(f"⚠️ Screen capture error: {e}")
            return None

    def has_screen_changed(self, current_img: Image.Image) -> bool:
        """Compares pixel differences with previous frame to save API tokens."""
        if self.previous_frame is None:
            self.previous_frame = current_img
            return True

        diff = ImageChops.difference(current_img, self.previous_frame)
        stat = ImageStat.Stat(diff)
        diff_value = sum(stat.mean) / len(stat.mean)

        # Update cached frame
        self.previous_frame = current_img
        return diff_value > self.diff_threshold

    async def analyze_screen_with_vision(self, img: Image.Image) -> ScreenErrorAlert | None:
        """Calls gpt-4o-mini to inspect the screen for actionable errors."""
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=80)
        base64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")

        prompt = (
            "You are a proactive desktop assistant monitoring a developer's screen. "
            "Examine the screenshot for terminal exceptions, compiler/build errors, test failures, "
            "missing env variables, 401/403 HTTP errors, or syntax bugs. "
            "If everything looks normal or a standard application is open without errors, set has_actionable_error to false."
        )

        try:
            response = await openai_client.beta.chat.completions.parse(
                model="gpt-4o-mini",  # Fast and cheap for continuous background checks
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{base64_str}",
                                    "detail": "low"  # Low detail suffices for error text/consoles
                                },
                            },
                        ],
                    }
                ],
                response_format=ScreenErrorAlert,
                max_tokens=200,
            )
            return response.choices[0].message.parsed
        except Exception as e:
            print(f"❌ Vision analysis error: {e}")
            return None

    async def publish_voice_alert(self, text: str):
        """Pushes alert to Redis Pub/Sub, triggering Jarvis to speak through WebSocket."""
        try:
            redis_client = await aioredis.from_url("redis://localhost:6379/0", decode_responses=True)
            channel = f"jarvis_notifications:{self.user_id}"
            payload = json.dumps({"message": text})
            await redis_client.publish(channel, payload)
            await redis_client.close()
            print(f"📡 Published proactive voice alert to Redis: '{text}'")
        except Exception as e:
            print(f"❌ Redis publish error: {e}")

    async def start(self):
        """Main background loop."""
        self.is_running = True
        print(f"👁️ Proactive Screen Monitor active for user: {self.user_id}")

        while self.is_running:
            await asyncio.sleep(self.check_interval_sec)

            current_img = await asyncio.to_thread(self.capture_screen_pil)
            if current_img is None:
                continue

            # Token saving check: skip API call if screen hasn't changed
            if not self.has_screen_changed(current_img):
                continue

            alert = await self.analyze_screen_with_vision(current_img)
            
            if alert and alert.has_actionable_error and alert.spoken_recommendation:
                # Deduplicate: Avoid repeating the same alert if the error stays on screen
                if alert.error_summary != self.last_reported_error:
                    self.last_reported_error = alert.error_summary
                    await self.publish_voice_alert(alert.spoken_recommendation)
            elif alert and not alert.has_actionable_error:
                # Reset error cache when screen clears
                self.last_reported_error = None