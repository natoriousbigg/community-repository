# ----------------------------------------------------------------------------------------------------
# Name: faster-whisper
# Description: Installs faster-whisper with the distil-large-v3 model for language detection and transcription.
# Author: OpenAI-Assistant
# Revision: 1
# Icon: fas fa-wave-square:#17A2B8
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -euo pipefail

log(){
    echo "[faster-whisper] $1"
}

MODEL_REPO="distil-whisper/distil-large-v3"
MODEL_DIR="/app/data/faster-whisper/models/distil-large-v3"

if [[ "${1:-}" == "--uninstall" ]]; then
    log "Uninstall flag detected. Removing faster-whisper and model files..."
    if command -v python3 >/dev/null 2>&1; then
        python3 -m pip uninstall -y faster-whisper huggingface_hub 2>/dev/null || true
    fi
    rm -rf "/app/data/faster-whisper"
    log "Uninstall complete."
    exit 0
fi

log "Ensuring system dependencies are installed (python3, pip, ffmpeg)."
apt-get -qq update
apt-get install -yqq python3 python3-pip ffmpeg

log "Upgrading pip and installing faster-whisper + huggingface_hub."
python3 -m pip install --upgrade --no-cache-dir pip
python3 -m pip install --no-cache-dir faster-whisper "huggingface_hub>=0.22"

log "Downloading model '${MODEL_REPO}' to ${MODEL_DIR}. This may take a while..."
python3 - <<PY
import os
from huggingface_hub import snapshot_download

model_dir = os.environ.get("MODEL_DIR", "${MODEL_DIR}")
os.makedirs(model_dir, exist_ok=True)
print(f"[faster-whisper] Downloading or updating model into {model_dir}")
snapshot_download(repo_id="${MODEL_REPO}", local_dir=model_dir, local_dir_use_symlinks=False)
print(f"[faster-whisper] Model ready at {model_dir}")
PY

log "faster-whisper installation and model download completed."
exit 0
