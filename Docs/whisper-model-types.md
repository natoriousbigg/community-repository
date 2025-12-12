# Whisper model usage

## Unified Model Approach

The transcription scripts now use a unified model approach for simplicity and optimal quality:

- **ggml-large-v3-turbo.bin**: The recommended model for all transcription tasks. It provides the best balance of speed, quality, and multilingual support (~99 languages). This model is used for both English and non-English audio, as well as translations.
- **ggml-base.bin**: Used exclusively for fast language detection before transcription. This smaller model quickly identifies the audio language without the overhead of the larger transcription models.

## Why This Approach?

Previous versions distinguished between English-only models (`*.en.bin`) and multilingual models (`*.bin`). The unified approach simplifies configuration and maintenance while leveraging the ggml-large-v3-turbo model's superior performance across all languages, including English.

## Model Recommendations

For best results:
1. Install the **Whisper.cpp - Binary and Base Model** DockerMod (provides the binary and ggml-base.bin for language detection)
2. Install the **Whisper.cpp - Large V3 Turbo Model** DockerMod (provides ggml-large-v3-turbo.bin for transcription)

Alternative models (ggml-large-v3.bin, ggml-medium.bin) are also supported but may be slower or lower quality than ggml-large-v3-turbo.bin.
