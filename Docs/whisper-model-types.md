# Whisper model variants (.bin vs .en.bin)

Whisper.cpp distributes two families of ggml model files:

- **Multilingual models (`*.bin`)**: support recognition and translation for ~99 languages. They are trained on the full Whisper dataset, so they can detect many languages and transcribe in-language or translate to English. File names end in just the size (for example `ggml-base.bin`, `ggml-medium.bin`).
- **English-only models (`*.en.bin`)**: fine-tuned strictly for English. Because they only contain English tokens, they run faster, use less memory, and often give slightly higher accuracy on English audio, but they cannot transcribe other languages. File names include `.en.bin` (for example `ggml-base.en.bin`, `ggml-medium.en.bin`).

In practice, use a multilingual `*.bin` model when you need automatic language detection or non-English transcripts. For translating other languages into English, the multilingual models are also the right choice—they understand the source language and can emit English translations directly. Choose an `*.en.bin` model when you only expect English and want a lighter or faster model with optimized English quality.
