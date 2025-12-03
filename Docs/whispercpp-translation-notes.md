# Whisper.cpp transcription vs translation

## Can whisper.cpp transcribe and translate simultaneously?
whisper.cpp uses the `--translate` flag to switch into translation mode, which outputs an English translation instead of the source-language transcript. The tool cannot emit both a native-language transcript and an English translation in a single invocation; it must be run once for transcription and a second time with `--translate true` for translation output.

## How to produce both outputs
1. Run whisper.cpp normally (without `--translate`) to generate the source-language SRT.
2. Run whisper.cpp again with `--translate true` against the same audio to produce the English SRT.

## Why two runs are needed
Translation mode replaces the transcript with the translated text, so the original-language subtitles are not produced when `--translate` is enabled. Separate invocations ensure each output is generated in its respective mode.

## Sample commands with diarization and silence filters
Use the same diarization and silence-handling switches for both passes so timing stays consistent.

**Transcription (source language)**
```bash
./main \
  -m models/ggml-medium.bin -f input.wav -osrt \
  --diarize true --split-on-word true --max-context 0 \
  --freq-thold 100 --suppress-blank true --no-speech-thold 0.6
```

**Translation (English)**
```bash
./main \
  -m models/ggml-medium.bin -f input.wav -osrt --translate true \
  --diarize true --split-on-word true --max-context 0 \
  --freq-thold 100 --suppress-blank true --no-speech-thold 0.6
```

Adjust `--freq-thold` and `--no-speech-thold` to control how aggressively whisper.cpp cuts off segments during silence; higher values shorten on-screen subtitles when speech pauses.
