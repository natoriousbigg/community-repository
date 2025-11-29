# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp
# Description: Installs the whisper.cpp CPU-only binary and downloads the ggml-small model (multilingual).
# Author: OpenAI-Assistant
# Revision: 6
# Icon: fas fa-microphone-lines:#007BFF
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -eu

log() {
    echo "[whisper.cpp] $1"
}

INSTALL_ROOT="/app/data/whispercpp"
BIN_DIR="${INSTALL_ROOT}/bin"
MODEL_DIR="${INSTALL_ROOT}/models"
BIN_LINK="/usr/local/bin/whisper-cli"
BIN_LINK_LEGACY="/usr/local/bin/whispercpp"
VERSION="1.8.2"
MODEL_FILE="${MODEL_DIR}/ggml-small.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

if [ "${1:-}" = "--uninstall" ]; then
    log "Uninstall flag detected. Removing whisper.cpp binaries and models..."
    rm -f "${BIN_LINK}" "${BIN_LINK_LEGACY}" || true
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
    if cmake -S "${build_dir}" -B "${build_dir}/build" -DCMAKE_BUILD_TYPE=Release; then
        if cmake --build "${build_dir}/build" -- -j"$(nproc)"; then
            if [ -x "${build_dir}/build/bin/whisper-cli" ]; then
                binary_path="${build_dir}/build/bin/whisper-cli"
            elif [ -x "${build_dir}/whisper-cli" ]; then
                binary_path="${build_dir}/whisper-cli"
            else
                log "Source build completed but 'whisper-cli' binary not found in expected locations."
                exit 1
            fi
        else
            log "Building whisper.cpp from source failed."
            exit 1
        fi
    else
        log "Configuring whisper.cpp with CMake failed."
        exit 1
    fi
else
    log "Cloning whisper.cpp repository failed."
    exit 1
fi

log "Installing binary to ${BIN_DIR}/whisper-cli and linking at ${BIN_LINK} (with legacy alias)."
install -m 0755 "${binary_path}" "${BIN_DIR}/whisper-cli"
ln -sf "${BIN_DIR}/whisper-cli" "${BIN_LINK}"
ln -sf "${BIN_DIR}/whisper-cli" "${BIN_LINK_LEGACY}"

log "Downloading default multilingual model to ${MODEL_FILE}."
curl -L "${MODEL_URL}" -o "${MODEL_FILE}"

log "whisper.cpp installation complete. Use 'whisper-cli -f <audio.wav> -m ${MODEL_FILE}' to transcribe. (Legacy alias: whispercpp)"
exit 0
