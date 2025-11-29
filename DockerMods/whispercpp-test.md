# Testing whisper.cpp installation

Use these commands after applying the DockerMod to confirm whisper.cpp can detect the audio language from the provided MKV sample.

## 1) Extract the MKV audio to a 16 kHz mono WAV

```bash
docker exec -it <fileflows-container> bash -lc "\
  /usr/bin/ffmpeg -i /media/downloads/fileflow-test/samples/vc1-flipper-sample.mkv \
    -map 0:a:0 -ac 1 -ar 16000 -vn /tmp/vc1-flipper.wav"
```

- Converts the first audio track to PCM WAV for Whisper.
- Adjust `-map 0:a:0` if you need a different audio stream.

## 2) Detect language and transcribe a short segment

```bash
docker exec -it <fileflows-container> bash -lc "\
  /usr/local/bin/whisper-whispercpp \
    -m /app/data/whispercpp/models/ggml-small.bin \
    -f /tmp/vc1-flipper.wav \
    -l auto \
    -otxt \
    -of /tmp/vc1-flipper-sample \
    -n 90"
```

- `-l auto` prints `auto-detected language: <lang>` near the top of the logs.
- `-n 90` limits decoding to the first ~90 seconds for a quick check. Omit it to transcribe the full file.
- Outputs `/tmp/vc1-flipper-sample.txt` inside the container with the transcription.

## Notes
- Replace `<fileflows-container>` with your running FileFlows container name (e.g., `fileflows-node`).
- Run the commands from the host that can access the container via Docker.
- Both commands rely on the install locations defined by the Whisper.cpp DockerMod: `/usr/local/bin/whisper-whispercpp` (with a legacy alias at `/usr/local/bin/whispercpp`) and `/app/data/whispercpp/models/ggml-small.bin`.
