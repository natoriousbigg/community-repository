# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp - Medium Model
# Description: Downloads the ggml-medium Whisper.cpp multilingual model into /app/common/whispercpp/models.
#              Note: This model can be used for transcription, but ggml-large-v3-turbo is recommended for better quality and speed.
# Author: OpenAI-Assistant
# Revision: 9
# Icon: https://meta-l.cdn.bubble.io/f1695308256768x626644891139990000/open-ai.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -euo pipefail

log() {
    echo "[Whisper.cpp - Medium Model] $1"
}

MODEL_DIR="/app/common/whispercpp/models"
MODEL_FILE="${MODEL_DIR}/ggml-medium.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"

if [[ "${1:-}" == "--uninstall" ]]; then
    log "Uninstall flag detected. Removing model from ${MODEL_DIR}."
    rm -f "${MODEL_FILE}" || true
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

log "Download complete. Model available in ${MODEL_DIR}."
exit 0
