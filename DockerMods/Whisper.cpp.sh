#!/bin/sh
# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp
# Description: Installs the whisper.cpp CPU-only binary and downloads the ggml-small model (multilingual).
# Author: OpenAI-Assistant
# Revision: 6
# Icon: fas fa-microphone-lines:#007BFF
# ----------------------------------------------------------------------------------------------------
set -eu

log() {
    echo "[whisper.cpp] $1"
}

INSTALL_ROOT="/app/data/whispercpp"
BIN_DIR="${INSTALL_ROOT}/bin"
MODEL_DIR="${INSTALL_ROOT}/models"
BIN_LINK="/usr/local/bin/whispercpp"
VERSION="1.8.2"
MODEL_FILE="${MODEL_DIR}/ggml-small.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

if [ "${1:-}" = "--uninstall" ]; then
    log "Uninstall flag detected. Removing whisper.cpp binaries and models..."
    rm -f "${BIN_LINK}" || true
    rm -rf "${INSTALL_ROOT}"
    log "Uninstall complete."
    exit 0
fi

log "Installing required system packages (curl, ffmpeg, ca-certificates, git, build-essential, pkg-config, cmake)."
apt-get -qq update
apt-get install -yqq curl ffmpeg ca-certificates git build-essential pkg-config cmake

log "Preparing directories under ${INSTALL_ROOT}."
mkdir -p "${BIN_DIR}" "${MODEL_DIR}"

log "Building whisper.cpp v${VERSION} from source (no prebuilt binaries available)."
binary_path=""
build_dir="/tmp/whisper.cpp"
rm -rf "${build_dir}"
if git clone --branch "v${VERSION}" --depth 1 https://github.com/ggerganov/whisper.cpp "${build_dir}"; then
    if make -C "${build_dir}" -j"$(nproc)"; then
        if [ -x "${build_dir}/main" ]; then
            binary_path="${build_dir}/main"
        else
            log "Source build completed but 'main' binary not found at ${build_dir}/main."
            exit 1
        fi
    else
        log "Building whisper.cpp from source failed."
        exit 1
    fi
else
    log "Cloning whisper.cpp repository failed."
    exit 1
fi

log "Installing binary to ${BIN_DIR}/whispercpp and linking at ${BIN_LINK}."
install -m 0755 "${binary_path}" "${BIN_DIR}/whispercpp"
ln -sf "${BIN_DIR}/whispercpp" "${BIN_LINK}"

log "Downloading default multilingual model to ${MODEL_FILE}."
curl -L "${MODEL_URL}" -o "${MODEL_FILE}"

log "whisper.cpp installation complete. Use 'whispercpp -f <audio.wav> -m ${MODEL_FILE}' to transcribe."
exit 0
