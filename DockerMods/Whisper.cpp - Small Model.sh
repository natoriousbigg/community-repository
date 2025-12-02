# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp - Small Model
# Description: Downloads the ggml-small Whisper.cpp model into $common/whisper-models and creates
#              a symlink model.bin -> ggml-small.bin for default usage.
# Author: OpenAI-Assistant
# Revision: 2
# Icon: https://meta-l.cdn.bubble.io/f1695308256768x626644891139990000/open-ai.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -euo pipefail

log() {
    echo "[Whisper.cpp - Small Model] $1"
}

COMMON_PATH="${common:-/app/common}"
COMMON_PATH="${COMMON_PATH%/}"
MODEL_DIR="${COMMON_PATH}/whisper-models"
MODEL_FILE="${MODEL_DIR}/ggml-small.bin"
MODEL_LINK="${MODEL_DIR}/model.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

if [[ "${1:-}" == "--uninstall" ]]; then
    log "Uninstall flag detected. Removing model and symlink from ${MODEL_DIR}."
    rm -f "${MODEL_FILE}" "${MODEL_LINK}" || true
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

log "Downloading ggml-small Whisper.cpp model from Hugging Face."
curl -L "${MODEL_URL}" -o "${MODEL_FILE}"

log "Creating symbolic link ${MODEL_LINK} -> ${MODEL_FILE}."
ln -sfn "${MODEL_FILE}" "${MODEL_LINK}"

log "Download complete. Model available at ${MODEL_FILE} (symlink: ${MODEL_LINK})."
exit 0
