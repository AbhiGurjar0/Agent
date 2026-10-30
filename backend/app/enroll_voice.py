import torch
import sounddevice as sd
import numpy as np
from speechbrain.inference.speaker import SpeakerRecognition

# Load lightweight ECAPA-TDNN speaker embedding model
verification_model = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb", 
    savedir="tmp_model"
)

SAMPLE_RATE = 16000
DURATION = 5  # seconds

print("🎙️ Please speak naturally for 5 seconds to enroll your voiceprint...")
audio = sd.rec(int(DURATION * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype='float32')
sd.wait()
print("✅ Recording finished! Processing embedding...")

# Reshape and extract embedding
audio_tensor = torch.tensor(audio.T)
embedding = verification_model.encode_batch(audio_tensor)

# Save embedding to file
torch.save(embedding, "user_voiceprint.pt")
print("🎉 Voiceprint saved to 'user_voiceprint.pt' successfully!")