# Whisper.cpp transcription vs translation

## Can whisper.cpp transcribe and translate simultaneously?
whisper.cpp uses the `--translate` flag to switch into translation mode, which outputs an English translation instead of the source-language transcript. The tool cannot emit both a native-language transcript and an English translation in a single invocation; it must be run once for transcription and a second time with `--translate true` for translation output.

## How to produce both outputs
1. Run whisper.cpp normally (without `--translate`) to generate the source-language SRT.
2. Run whisper.cpp again with `--translate true` against the same audio to produce the English SRT.

## Why two runs are needed
Translation mode replaces the transcript with the translated text, so the original-language subtitles are not produced when `--translate` is enabled. Separate invocations ensure each output is generated in its respective mode.
