# app/ai/voice_service.py
import os
import io
import whisper
from gtts import gTTS
from pathlib import Path

# Load lightweight Whisper model locally (you can use "base" or "small")
print("Loading local Whisper model...")
whisper_model = whisper.load_model("base")

SAFE_WORKSPACE = Path("./workspace").resolve()
SAFE_WORKSPACE.mkdir(exist_ok=True)

def speech_to_text(audio_file_path: str) -> str:
    """Transcribes an audio file into text using local Whisper."""
    try:
        result = whisper_model.transcribe(audio_file_path)
        return result.get("text", "").strip()
    except Exception as e:
        return f"Transcription error: {str(e)}"

def text_to_speech_bytes(text: str) -> bytes:
    """Converts text response to MP3 audio bytes completely in memory."""
    try:
        mp3_fp = io.BytesIO()
        tts = gTTS(text=text, lang='en', slow=False)
        tts.write_to_fp(mp3_fp)
        mp3_fp.seek(0)
        return mp3_fp.read()
    except Exception as e:
        print(f"❌ In-Memory TTS Error: {e}")
        return b""