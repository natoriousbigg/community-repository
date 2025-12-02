# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp - Medium Model & Solera VAD
# Description: Downloads the ggml-medium Whisper.cpp model and Silero VAD model into /app/common/whisper-model,
#              creating symlinks model.bin and vad-model.bin for default usage.
# Author: OpenAI-Assistant
# Revision: 1
# Icon: https://meta-l.cdn.bubble.io/f1695308256768x626644891139990000/open-ai.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -euo pipefail

log() {
    echo "[Whisper.cpp - Medium Model & Solera VAD] $1"
}

COMMON_PATH="${common:-/app/common}"
COMMON_PATH="${COMMON_PATH%/}"
MODEL_DIR="${COMMON_PATH}/whisper-model"
MODEL_FILE="${MODEL_DIR}/ggml-medium.bin"
MODEL_LINK="${MODEL_DIR}/model.bin"
VAD_FILE="${MODEL_DIR}/ggml-silero-v6.2.0.bin"
VAD_LINK="${MODEL_DIR}/vad-model.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
VAD_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"

if [[ "${1:-}" == "--uninstall" ]]; then
    log "Uninstall flag detected. Removing models and symlinks from ${MODEL_DIR}."
    rm -f "${MODEL_FILE}" "${MODEL_LINK}" "${VAD_FILE}" "${VAD_LINK}" || true
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

log "Downloading ggml-medium Whisper.cpp model from Hugging Face."
curl -L --fail "${MODEL_URL}" -o "${MODEL_FILE}"

log "Downloading Silero VAD model from Hugging Face."
curl -L --fail "${VAD_URL}" -o "${VAD_FILE}"

log "Creating symbolic links ${MODEL_LINK} -> ${MODEL_FILE} and ${VAD_LINK} -> ${VAD_FILE}."
ln -sfn "${MODEL_FILE}" "${MODEL_LINK}"
ln -sfn "${VAD_FILE}" "${VAD_LINK}"

log "Download complete. Models available in ${MODEL_DIR} (symlinks: ${MODEL_LINK}, ${VAD_LINK})."
exit 0
