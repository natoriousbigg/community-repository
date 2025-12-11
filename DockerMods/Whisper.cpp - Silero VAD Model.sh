# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp - Silero VAD Model
# Description: Downloads the Silero VAD (Voice Activity Detection) model for use with Whisper.cpp.
#              This model helps improve transcription accuracy and prevents subtitle lingering.
# Author: OpenAI-Assistant
# Revision: 1
# Icon: https://meta-l.cdn.bubble.io/f1695308256768x626644891139990000/open-ai.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -euo pipefail

log() {
    echo "[Whisper.cpp - Silero VAD Model] $1"
}

MODEL_DIR="/app/common/whispercpp/models"
MODEL_FILE="${MODEL_DIR}/ggml-silero-v6.2.0.bin"
MODEL_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"

if [[ "${1:-}" == "--uninstall" ]]; then
    log "Uninstall flag detected. Removing VAD model from ${MODEL_DIR}."
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
    log "Silero VAD model already present at ${MODEL_FILE}; skipping download."
else
    log "Downloading Silero VAD model from Hugging Face."
    curl -L --fail "${MODEL_URL}" -o "${MODEL_FILE}"
fi

log "Download complete. VAD model available in ${MODEL_DIR}."
exit 0
