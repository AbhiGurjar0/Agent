import asyncio
import json
import io
import time
import subprocess
import websockets
import numpy as np
import scipy.io.wavfile as wav
import sounddevice as sd
import soundfile as sf
from pathlib import Path

WS_URL = "ws://localhost:8000/api/v1/chats/ws/audio-chat"
SAMPLE_RATE = 44100

VOLUME_THRESHOLD = 0.035
INTERRUPT_THRESHOLD = 0.12
SILENCE_LIMIT_SEC = 2.0
BLOCK_DURATION = 0.1
BLOCK_SIZE = int(SAMPLE_RATE * BLOCK_DURATION)

SAFE_WORKSPACE = Path("./workspace").resolve()
SAFE_WORKSPACE.mkdir(parents=True, exist_ok=True)


def capture_active_screen():
    """Takes a quick, compressed screenshot of the primary display."""
    screenshot_path = SAFE_WORKSPACE / "active_screen.jpg"
    subprocess.run(["screencapture", "-x", "-t", "jpg", str(screenshot_path)], check=False)
    return screenshot_path if screenshot_path.exists() else None


def record_until_silence():
    print("\n🎙️ Listening...")
    frames = []
    silent_blocks = 0
    max_silent_blocks = int(SILENCE_LIMIT_SEC / BLOCK_DURATION)
    has_spoken = False

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype=np.int16) as stream:
        while True:
            audio_chunk, _ = stream.read(BLOCK_SIZE)
            audio_float = audio_chunk.astype(np.float32) / 32768.0
            volume = np.sqrt(np.mean(audio_float**2))

            if volume > VOLUME_THRESHOLD:
                has_spoken = True
                silent_blocks = 0
                frames.append(audio_chunk)
            elif has_spoken:
                silent_blocks += 1
                frames.append(audio_chunk)
                if silent_blocks >= max_silent_blocks:
                    frames = frames[:-max_silent_blocks]
                    print("🛑 Pause detected. Sending...")
                    break

    if not frames:
        return None

    audio_data = np.concatenate(frames, axis=0)
    buffer = io.BytesIO()
    wav.write(buffer, SAMPLE_RATE, audio_data)
    return buffer.getvalue()


async def main():
    print("🚀 Connecting to WebSocket server with Full Parallelism...")
    async with websockets.connect(WS_URL) as websocket:
        print("⚡ Connected! Start talking whenever ready.")

        playback_task = None
        current_interrupt_flag = asyncio.Event()

        async def listen_loop():
            """Continuously listens to microphone and sends audio to the server."""
            while True:
                audio_bytes = await asyncio.to_thread(record_until_silence)
                if audio_bytes:
                    print("🚀 Sending voice prompt...")
                    await websocket.send(audio_bytes)

        async def receive_loop():
            nonlocal playback_task, current_interrupt_flag
            """Continuously receives server responses, notifications, and audio streams."""
            try:
                while True:
                    response = await websocket.recv()

                    if isinstance(response, str):
                        data = json.loads(response)
                        if "notification" in data:
                            print(f"\n🔔 [Spontaneous Alert]: {data['notification']}")
                        elif "response_text" in data:
                            print(f"\n🤖 AI Heard: {data.get('transcribed_prompt')}")
                            print(f"🤖 AI Response: {data.get('response_text')}")

                    elif isinstance(response, bytes):
                        # If Jarvis is already speaking, cancel the previous playback
                        if playback_task and not playback_task.done():
                            current_interrupt_flag.set()
                            playback_task.cancel()

                        current_interrupt_flag = asyncio.Event()
                        
                        # Start non-blocking playback task
                        playback_task = asyncio.create_task(
                            play_audio_with_interrupt(response, current_interrupt_flag, websocket)
                        )

            except websockets.ConnectionClosed:
                print("⚡ WebSocket connection closed.")

        async def play_audio_with_interrupt(audio_bytes, interrupt_event, ws):
            """Plays audio while monitoring mic for interruption using a callback."""
            data, samplerate = sf.read(io.BytesIO(audio_bytes))
            duration = len(data) / samplerate
            current_volume = 0.0

            def audio_callback(indata, frames, time_info, status):
                nonlocal current_volume
                audio_float = indata.astype(np.float32) / 32768.0
                current_volume = np.sqrt(np.mean(audio_float**2))

            sd.play(data, samplerate)
            start_time = time.time()

            try:
                with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype=np.int16, callback=audio_callback):
                    while (time.time() - start_time) < duration:
                        if interrupt_event.is_set():
                            sd.stop()
                            return

                        if current_volume > INTERRUPT_THRESHOLD:
                            print("\n⚡ [Interruption Detected] Cutting off audio!")
                            sd.stop()
                            interrupt_event.set()
                            # Instantly notify backend to drop output
                            await ws.send(json.dumps({"type": "cancel_last"}))
                            return

                        await asyncio.sleep(0.02)
            except asyncio.CancelledError:
                sd.stop()

        # Run listener and receiver concurrently
        await asyncio.gather(listen_loop(), receive_loop())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Voice assistant stopped.")

