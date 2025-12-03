# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp - Medium Model & Solera VAD
# Description: Downloads the ggml-medium Whisper.cpp multilingual and English models plus the Silero VAD model into
#              /app/common/whispercpp/models.
# Author: OpenAI-Assistant
# Revision: 6
# Icon: https://meta-l.cdn.bubble.io/f1695308256768x626644891139990000/open-ai.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -euo pipefail

log() {
    echo "[Whisper.cpp - Medium Model & Solera VAD] $1"
}

MODEL_DIR="/app/common/whispercpp/models"
MODEL_FILE="${MODEL_DIR}/ggml-medium.bin"
MODEL_EN_FILE="${MODEL_DIR}/ggml-medium.en.bin"
VAD_FILE="${MODEL_DIR}/ggml-silero-v6.2.0.bin"
TINY_DIARIZE_EN_FILE="${MODEL_DIR}/ggml-small.en-tdrz.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
MODEL_EN_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin"
VAD_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"
TINY_DIARIZE_EN_URL="https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/main/ggml-small.en-tdrz.bin"

if [[ "${1:-}" == "--uninstall" ]]; then
    log "Uninstall flag detected. Removing models from ${MODEL_DIR}."
    rm -f "${MODEL_FILE}" "${MODEL_EN_FILE}" "${VAD_FILE}" "${TINY_DIARIZE_EN_FILE}" || true
    rmdir --ignore-fail-on-non-empty "${MODEL_DIR}" 2>/dev/null || true
    exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
    log "curl not found. Installing curl."
    apt-get -qq update
    apt-get install -yqq curl
fi

log "Creating model directory at ${MODEL_DIR}."
mkdir -p "${MODEL_DIR}"

if [[ -f "${MODEL_FILE}" ]]; then
    log "Multilingual model already present at ${MODEL_FILE}; skipping download."
else
    log "Downloading ggml-medium Whisper.cpp multilingual model from Hugging Face."
    curl -L --fail "${MODEL_URL}" -o "${MODEL_FILE}"
fi

if [[ -f "${MODEL_EN_FILE}" ]]; then
    log "English model already present at ${MODEL_EN_FILE}; skipping download."
else
    log "Downloading ggml-medium Whisper.cpp English model from Hugging Face."
    curl -L --fail "${MODEL_EN_URL}" -o "${MODEL_EN_FILE}"
fi

if [[ -f "${VAD_FILE}" ]]; then
    log "Silero VAD model already present at ${VAD_FILE}; skipping download."
else
    log "Downloading Silero VAD model from Hugging Face."
    curl -L --fail "${VAD_URL}" -o "${VAD_FILE}"
fi

if [[ -f "${TINY_DIARIZE_EN_FILE}" ]]; then
    log "TinyDiarize English model already present at ${TINY_DIARIZE_EN_FILE}; skipping download."
else
    log "Downloading TinyDiarize English Whisper.cpp model from Hugging Face."
    curl -L --fail "${TINY_DIARIZE_EN_URL}" -o "${TINY_DIARIZE_EN_FILE}"
fi

log "Download complete. Models available in ${MODEL_DIR}."
exit 0
