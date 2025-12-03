# Whisper.cpp subtitle timing tips

When Whisper.cpp leaves subtitles on screen during silence, tighten its segmenting and silence filtering. These switches focus on breaking segments sooner and cutting output when speech stops, including when running translation or transcription with diarized speakers.

## Cut to silence quickly
- **Enable VAD**: `--vad-filter true` uses Silero VAD so segments end when speech energy drops.
- **Tune VAD thresholds**: `--vad-thold 0.4` (speech probability) makes end-of-utterance detection more aggressive. Raise the threshold if you see noisy cutoffs; lower it if segments run long.
- **Reject non-speech tokens**: `--no-speech-thold 0.6` helps Whisper skip "empty" tokens that otherwise extend segment timing.
- **Track speakers**: `--diarize true` adds speaker labels without changing timing, which keeps separated speakers from being merged into the same lingering subtitle line.

## Keep subtitle segments short
- **Split on word boundaries**: `--split-on-word true` avoids timing drift by snapping cuts to words instead of token boundaries.
- **Cap segment length**: `--max-len 20` (roughly a line of ~16 words) forces Whisper.cpp to close a segment instead of letting it accumulate a long chunk that lingers on-screen.
- **Limit context carry-over**: `--max-context 0` stops the model from reusing too much prior text, which can otherwise encourage longer, merged segments.

## Example command
```bash
./main \
  -m models/ggml-medium.en.bin -f input.wav -osrt --translate \
  --diarize true \
  --vad-filter true --vad-thold 0.4 \
  --no-speech-thold 0.6 \
  --split-on-word true --max-len 20 --max-context 0
```

Start with these values, then adjust `--vad-thold` and `--max-len` until subtitle lines cut off soon after speech ends without chopping words mid-sentence.
