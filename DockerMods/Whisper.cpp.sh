# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp
# Description: Installs the whisper.cpp CPU-only binary and downloads the ggml-base.en model.
# Author: OpenAI-Assistant
# Revision: 1
# Icon: fas fa-microphone-lines:#007BFF
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -euo pipefail

log(){
    echo "[whisper.cpp] $1"
}

INSTALL_ROOT="/app/data/whispercpp"
BIN_DIR="${INSTALL_ROOT}/bin"
MODEL_DIR="${INSTALL_ROOT}/models"
BIN_LINK="/usr/local/bin/whispercpp"
VERSION="1.6.2"
MODEL_FILE="${MODEL_DIR}/ggml-base.en.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

if [[ "${1:-}" == "--uninstall" ]]; then
    log "Uninstall flag detected. Removing whisper.cpp binaries and models..."
    rm -f "${BIN_LINK}" || true
    rm -rf "${INSTALL_ROOT}"
    log "Uninstall complete."
    exit 0
fi

ARCH_TAG=""
case "$(uname -m)" in
    x86_64)
        ARCH_TAG="x64"
        ;;
    aarch64|arm64)
        ARCH_TAG="aarch64"
        ;;
    *)
        log "Unsupported architecture: $(uname -m). Only x86_64 and aarch64 are supported."
        exit 1
        ;;
esac

BUNDLE_URL="https://github.com/ggerganov/whisper.cpp/releases/download/v${VERSION}/whisper.cpp-linux-${ARCH_TAG}.zip"

log "Installing required system packages (curl, unzip, ffmpeg, ca-certificates)."
apt-get -qq update
apt-get install -yqq curl unzip ffmpeg ca-certificates

log "Preparing directories under ${INSTALL_ROOT}."
mkdir -p "${BIN_DIR}" "${MODEL_DIR}"

log "Downloading whisper.cpp v${VERSION} for ${ARCH_TAG}."
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
curl -L "${BUNDLE_URL}" -o "${tmp_dir}/whisper.zip"

log "Extracting whisper.cpp bundle."
unzip -q "${tmp_dir}/whisper.zip" -d "${tmp_dir}/unpacked"

binary_path="$(find "${tmp_dir}/unpacked" -maxdepth 2 -type f -name main | head -n 1)"
if [[ -z "${binary_path}" ]]; then
    log "Failed to locate the whisper.cpp 'main' binary in the downloaded bundle."
    exit 1
fi

log "Installing binary to ${BIN_DIR}/whispercpp and linking at ${BIN_LINK}."
install -m 0755 "${binary_path}" "${BIN_DIR}/whispercpp"
ln -sf "${BIN_DIR}/whispercpp" "${BIN_LINK}"

log "Downloading default model to ${MODEL_FILE}."
curl -L "${MODEL_URL}" -o "${MODEL_FILE}"

log "whisper.cpp installation complete. Use 'whispercpp -f <audio.wav> -m ${MODEL_FILE}' to transcribe."
exit 0
