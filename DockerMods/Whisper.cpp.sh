# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp
# Description: Installs the whisper.cpp binary with Vulkan support and downloads the ggml-small
#              multilingual and English models into /app/common/whispercpp/models.
# Author: OpenAI-Assistant
# Revision: 16
# Icon: https://meta-l.cdn.bubble.io/cdn-cgi/image/w=64,h=64,f=auto,dpr=2,fit=contain/f1695308256768x626644891139990000/open-ai.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -eu

log() {
    echo "[whisper.cpp] $1"
}

INSTALL_ROOT="/app/common/whispercpp"
BIN_DIR="${INSTALL_ROOT}/bin"
MODEL_DIR="${INSTALL_ROOT}/models"
SMALL_MULTILINGUAL="${MODEL_DIR}/ggml-small.bin"
SMALL_ENGLISH="${MODEL_DIR}/ggml-small.en.bin"
BIN_LINK="/usr/local/bin/whisper-cli"
VERSION="1.8.2"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
MODEL_EN_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"

if [ "${1:-}" = "--uninstall" ]; then
    log "Uninstall flag detected. Removing whisper.cpp binaries and models..."
    rm -f "${BIN_LINK}" || true
    rm -rf "${INSTALL_ROOT}"
    rm -f "${SMALL_MULTILINGUAL}" "${SMALL_ENGLISH}" || true
    rmdir --ignore-fail-on-non-empty "${MODEL_DIR}" 2>/dev/null || true
    log "Uninstall complete."
    exit 0
fi

log "Preparing directories under ${INSTALL_ROOT} and ${MODEL_DIR}."
mkdir -p "${BIN_DIR}" "${MODEL_DIR}"

binary_path=""

if ! command -v curl >/dev/null 2>&1; then
    log "curl not found. Installing curl and CA certificates."
    apt-get -qq update
    apt-get install -yqq curl ca-certificates
fi

if [ -x "${BIN_DIR}/whisper-cli" ]; then
    log "Existing whisper.cpp binary found at ${BIN_DIR}/whisper-cli; skipping rebuild."
    binary_path="${BIN_DIR}/whisper-cli"
else
    log "Installing required system packages (curl, ca-certificates, git, build-essential, pkg-config, cmake, Vulkan headers/libs, glslc)."
    apt-get -qq update
    apt-get install -yqq curl ca-certificates git build-essential pkg-config cmake libvulkan-dev vulkan-tools glslc

    if ! command -v glslc >/dev/null 2>&1; then
        log "Required Vulkan shader compiler 'glslc' not found after package installation. Ensure the glslc package is available in your image repositories or install it manually before rerunning."
        exit 1
    fi

    log "Building whisper.cpp v${VERSION} from source (no prebuilt binaries available)."
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

    log "Installing binary to ${BIN_DIR}/whisper-cli."
    install -m 0755 "${binary_path}" "${BIN_DIR}/whisper-cli"
    binary_path="${BIN_DIR}/whisper-cli"
fi

log "Linking binary at ${BIN_LINK}."
ln -sf "${binary_path}" "${BIN_LINK}"

if [ -f "${SMALL_MULTILINGUAL}" ]; then
    log "Multilingual model already present at ${SMALL_MULTILINGUAL}; skipping download."
else
    log "Downloading multilingual small model to ${SMALL_MULTILINGUAL}."
    curl -L --fail "${MODEL_URL}" -o "${SMALL_MULTILINGUAL}"
fi

if [ -f "${SMALL_ENGLISH}" ]; then
    log "English model already present at ${SMALL_ENGLISH}; skipping download."
else
    log "Downloading English small model to ${SMALL_ENGLISH}."
    curl -L --fail "${MODEL_EN_URL}" -o "${SMALL_ENGLISH}"
fi

log "whisper.cpp installation complete. Models installed under ${MODEL_DIR}."
exit 0
