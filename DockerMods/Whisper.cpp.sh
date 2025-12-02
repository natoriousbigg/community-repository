# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp
# Description: Installs the whisper.cpp binary with Vulkan support and downloads the ggml-small model
#              into /app/common/whisper-model with a model.bin symlink.
# Author: OpenAI-Assistant
# Revision: 11
# Icon: https://meta-l.cdn.bubble.io/cdn-cgi/image/w=64,h=64,f=auto,dpr=2,fit=contain/f1695308256768x626644891139990000/open-ai.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -eu

log() {
    echo "[whisper.cpp] $1"
}

BIN_ROOT="/app/common/whispercpp"
BIN_DIR="${BIN_ROOT}/bin"
MODEL_DIR="/app/common/whisper-model"
MODEL_FILE="${MODEL_DIR}/ggml-small.bin"
MODEL_LINK="${MODEL_DIR}/model.bin"
BIN_LINK="/usr/local/bin/whisper-cli"
BIN_LINK_LEGACY="/usr/local/bin/whispercpp"
VERSION="1.8.2"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

if [ "${1:-}" = "--uninstall" ]; then
    log "Uninstall flag detected. Removing whisper.cpp binaries and models..."
    rm -f "${BIN_LINK}" "${BIN_LINK_LEGACY}" || true
    rm -rf "${BIN_ROOT}"
    rm -f "${MODEL_FILE}" "${MODEL_LINK}" || true
    rmdir --ignore-fail-on-non-empty "${MODEL_DIR}" 2>/dev/null || true
    log "Uninstall complete."
    exit 0
fi

log "Installing required system packages (curl, ca-certificates, git, build-essential, pkg-config, cmake, Vulkan headers/libs, glslc)."
apt-get -qq update
apt-get install -yqq curl ca-certificates git build-essential pkg-config cmake libvulkan-dev vulkan-tools glslc

if ! command -v glslc >/dev/null 2>&1; then
    log "Required Vulkan shader compiler 'glslc' not found after package installation. Ensure the glslc package is available in your image repositories or install it manually before rerunning."
    exit 1
fi

log "Preparing directories under ${BIN_ROOT} and ${MODEL_DIR}."
mkdir -p "${BIN_DIR}" "${MODEL_DIR}"

log "Building whisper.cpp v${VERSION} from source (no prebuilt binaries available)."
binary_path=""
build_dir="/tmp/whisper.cpp"
rm -rf "${build_dir}"
if git clone --branch "v${VERSION}" --depth 1 https://github.com/ggerganov/whisper.cpp "${build_dir}"; then
    if cmake -S "${build_dir}" -B "${build_dir}/build" -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=1; then
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

log "Creating symbolic link ${MODEL_LINK} -> ${MODEL_FILE}."
ln -sfn "${MODEL_FILE}" "${MODEL_LINK}"

log "whisper.cpp installation complete. Use 'whisper-cli --file <audio.wav> --model ${MODEL_LINK}' to transcribe. (Legacy alias: whispercpp)"
exit 0
