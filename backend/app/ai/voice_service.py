# app/ai/voice_service.py
import os
import io
from pathlib import Path
from gtts import gTTS
from openai import OpenAI, AzureOpenAI
from app.ai.config import config


SAFE_WORKSPACE = Path("./workspace").resolve()
SAFE_WORKSPACE.mkdir(exist_ok=True)

TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "whisper-1")  # on Azure: your transcription deployment name

def _sync_client():
    if config.azure_openai_endpoint and config.azure_openai_api_key:
        return AzureOpenAI(
            azure_endpoint=config.azure_openai_endpoint.split("/openai")[0].rstrip("/"),
            api_key=config.azure_openai_api_key,
            api_version=config.azure_openai_api_version,
        )
    return OpenAI(api_key=config.openai_api_key)



def speech_to_text(audio_file_path: str) -> str:
    try:
        with open(audio_file_path, "rb") as f:
            result = _sync_client().audio.transcriptions.create(
                model=TRANSCRIBE_MODEL, file=f
            )
        return (result.text or "").strip()
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