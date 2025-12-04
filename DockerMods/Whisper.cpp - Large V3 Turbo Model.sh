# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp - Large V3 Turbo Model
# Description: Downloads the ggml-large-v3-turbo Whisper.cpp multilingual model into /app/common/whispercpp/models.
# Author: OpenAI-Assistant
# Revision: 1
# Icon: https://meta-l.cdn.bubble.io/f1695308256768x626644891139990000/open-ai.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -euo pipefail

log() {
    echo "[Whisper.cpp - Large V3 Turbo Model] $1"
}

MODEL_DIR="/app/common/whispercpp/models"
MODEL_FILE="${MODEL_DIR}/ggml-large-v3-turbo.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

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
    log "Large V3 Turbo model already present at ${MODEL_FILE}; skipping download."
else
    log "Downloading ggml-large-v3-turbo Whisper.cpp model from Hugging Face."
    curl -L --fail "${MODEL_URL}" -o "${MODEL_FILE}"
fi

log "Download complete. Model available in ${MODEL_DIR}."
exit 0
