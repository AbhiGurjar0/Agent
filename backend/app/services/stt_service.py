# app/services/stt_service.py
import tempfile
import numpy as np
import sounddevice as sd
from scipy.io.wavfile import write
from faster_whisper import WhisperModel

# Initialize Whisper model once in memory (base or small is ultra-fast on macOS)
# Runs locally on CPU/Apple Silicon using int8 quantization
model = WhisperModel("base", device="cpu", compute_type="int8")

def record_audio_until_silence(
    sample_rate: int = 16000, 
    silence_threshold: float = 0.02, 
    silence_duration: float = 1.2, 
    max_duration: float = 15.0
) -> str:
    """Records microphone audio until the user stops speaking (silence detected)."""
    print("🎙️ Listening for your command...")
    
    audio_data = []
    silent_chunks = 0
    chunk_samples = int(sample_rate * 0.1) # 100ms chunks
    max_silent_chunks = int(silence_duration / 0.1)
    max_chunks = int(max_duration / 0.1)
    
    has_speech_started = False

    with sd.InputStream(samplerate=sample_rate, channels=1, dtype='float32') as stream:
        for _ in range(max_chunks):
            chunk, _ = stream.read(chunk_samples)
            amplitude = np.max(np.abs(chunk))
            audio_data.append(chunk)

            # Wait for user to actually start speaking
            if amplitude > silence_threshold:
                has_speech_started = True
                silent_chunks = 0
            elif has_speech_started:
                silent_chunks += 1
                # Stop if silence persists for silence_duration seconds
                if silent_chunks >= max_silent_chunks:
                    print("🛑 Silence detected. Processing...")
                    break

    if not audio_data:
        return ""

    # Concatenate all recorded audio chunks into one array
    full_audio = np.concatenate(audio_data, axis=0)
    
    # Save temporary WAV file for Whisper transcription
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
        tmp_filename = tmp_file.name
        # Convert float32 array to 16-bit PCM integer WAV
        write(tmp_filename, sample_rate, (full_audio * 32767).astype(np.int16))

    return tmp_filename


def transcribe_audio(file_path: str) -> str:
    """Converts recorded WAV audio into clean text using local Faster-Whisper."""
    if not file_path:
        return ""

    segments, _ = model.transcribe(
        file_path, 
        beam_size=1, 
        vad_filter=True, # Automatically filters out background noise
        language="en"
    )

    transcript = " ".join([segment.text.strip() for segment in segments])
    return transcript.strip()