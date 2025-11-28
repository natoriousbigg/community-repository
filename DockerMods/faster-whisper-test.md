# Testing faster-whisper installation

Use these commands after applying the DockerMod to confirm that the small faster-whisper model and its dependencies are installed correctly inside the FileFlows container.

## 1) Verify the virtual environment and package install

```bash
docker exec -it <fileflows-container> bash -lc "\
  /app/data/faster-whisper/venv/bin/pip show faster-whisper && \
  /app/data/faster-whisper/venv/bin/python - <<'PY'
from faster_whisper import WhisperModel
import pathlib
model_dir = pathlib.Path('/app/data/faster-whisper/models/faster-whisper-small')
print('Model directory exists:', model_dir.exists())
model = WhisperModel(str(model_dir), device='cpu', compute_type='int8')
print('Loaded model size:', model.half or 'int8')
PY"
```

The command confirms the package is installed, the model folder exists, and the model can be loaded with CPU int8 inference.

## 2) Run a quick transcription smoke test

This test generates a one-second 440 Hz sine-wave WAV file, runs a transcription, and prints the detected language and first segment. The recognized text will be nonsensical (the audio is just a tone), but successful execution proves the model, FFmpeg, and `ctranslate2` backend are working.

```bash
docker exec -it <fileflows-container> bash -lc "\
  /app/data/faster-whisper/venv/bin/python - <<'PY'
import math, wave, struct, pathlib, tempfile
from faster_whisper import WhisperModel

tmp = pathlib.Path(tempfile.gettempdir()) / 'fw_smoke.wav'
sample_rate = 16000
with wave.open(tmp, 'w') as f:
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(sample_rate)
    for i in range(sample_rate):
        value = int(32767 * math.sin(2 * math.pi * 440 * (i / sample_rate)))
        f.writeframes(struct.pack('<h', value))

model = WhisperModel('/app/data/faster-whisper/models/faster-whisper-small', device='cpu', compute_type='int8')
segments, info = model.transcribe(str(tmp), beam_size=1)
print('Detected language:', info.language, f"(p={info.language_probability:.3f})")
first = next(segments, None)
print('First segment text:', first.text.strip() if first else '<none>')
PY"
```

## Notes
- Replace `<fileflows-container>` with the name of your running FileFlows container (e.g., `fileflows-node`).
- If you want to test against a real audio file, replace `tmp` with the path to your sample and skip the sine-wave generation block.
- Both commands rely on the small model path defined in the DockerMod: `/app/data/faster-whisper/models/faster-whisper-small`.
