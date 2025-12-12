# Whisper model usage

## Dual-Pathway Model Approach

The transcription scripts now use a dual-pathway approach for optimal performance:

- **ggml-base.bin**: Used exclusively for fast language detection before transcription. This smaller model quickly identifies the audio language without the overhead of the larger transcription models.
- **ggml-distil-large-v3.5.bin** (English pathway): Optimized model specifically for English transcription. This model is faster and more accurate for English content than general multilingual models.
- **ggml-large-v3-turbo.bin** (Multi-language pathway): Best model for non-English languages, supporting ~99 languages with excellent quality and speed.

## How It Works

1. **Language Detection**: The script first uses `ggml-base.bin` to quickly detect the spoken language in the audio
2. **Model Selection**: Based on the detected language:
   - If English (`en`) is detected → uses `ggml-distil-large-v3.5.bin` for transcription
   - If any other language is detected → uses `ggml-large-v3-turbo.bin` for transcription
3. **Fallback Behavior**: If the preferred model isn't available, the script will fall back to whatever transcription model is present

## Why This Approach?

Using language-specific models provides several benefits:

- **Better English Quality**: The Distil Large V3.5 model is specifically trained and optimized for English, providing higher accuracy for English content
- **Faster English Processing**: English-optimized models are typically smaller and faster than multilingual models while maintaining or exceeding quality
- **Optimal Multi-language Support**: Large V3 Turbo provides the best balance of speed and quality for the 99+ non-English languages supported by Whisper
- **Automatic Selection**: The dual-pathway approach automatically selects the best model without user intervention

## Model Recommendations

For best results:
1. Install the **Whisper.cpp - Binary and Models** DockerMod (revision 8 or later)
   - Provides the whisper-cli binary
   - Downloads ggml-base.bin (language detection)
   - Downloads ggml-distil-large-v3.5.bin (English transcription)
   - Downloads ggml-large-v3-turbo.bin (multi-language transcription)
   - Downloads Silero VAD model (voice activity detection)

## Fallback Models

If you have other models installed, the scripts support the following fallback options in order of preference:

**For multi-language transcription:**
1. ggml-large-v3-turbo.bin (recommended)
2. ggml-large-v3.bin
3. ggml-large.bin
4. ggml-medium.bin

**For English transcription:**
1. ggml-distil-large-v3.5.bin (recommended)
2. Falls back to multi-language models if English model not available

You can manually download and place alternative models in `/app/common/whispercpp/models/` if needed.
