# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp
# Description: Installs the whisper.cpp binary with Vulkan support and downloads the ggml-base
#              multilingual and English models into /app/common/whispercpp/models.
# Author: OpenAI-Assistant
# Revision: 18
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
BASE_MULTILINGUAL="${MODEL_DIR}/ggml-base.bin"
BASE_ENGLISH="${MODEL_DIR}/ggml-base.en.bin"
BIN_LINK="/usr/local/bin/whisper-cli"
VERSION="1.8.2.01"
BINARY_URL="https://github.com/natoriousbigg/whisper.cpp/releases/download/v${VERSION}/whisper-cli-v${VERSION}-ubuntu-x64.zip"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
MODEL_EN_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

if [ "${1:-}" = "--uninstall" ]; then
    log "Uninstall flag detected. Removing whisper.cpp binaries and models..."
    rm -f "${BIN_LINK}" || true
    rm -rf "${INSTALL_ROOT}"
    rm -f "${BASE_MULTILINGUAL}" "${BASE_ENGLISH}" || true
    rmdir --ignore-fail-on-non-empty "${MODEL_DIR}" 2>/dev/null || true
    log "Uninstall complete."
    exit 0
fi

log "Preparing directories under ${INSTALL_ROOT} and ${MODEL_DIR}."
mkdir -p "${BIN_DIR}" "${MODEL_DIR}"

binary_path=""

packages=()

if ! command -v curl >/dev/null 2>&1; then
    log "curl not found. Installing curl and CA certificates."
    packages+=(curl ca-certificates)
fi

if ! command -v unzip >/dev/null 2>&1; then
    log "unzip not found. Installing unzip."
    packages+=(unzip)
fi

if ! command -v vulkaninfo >/dev/null 2>&1; then
    log "vulkan-tools not found. Installing vulkan-tools for Vulkan diagnostics."
    packages+=(vulkan-tools)
fi

if [ ${#packages[@]} -gt 0 ]; then
    apt-get -qq update
    apt-get install -yqq "${packages[@]}"
fi

if [ -x "${BIN_DIR}/whisper-cli" ]; then
    log "Existing whisper.cpp binary found at ${BIN_DIR}/whisper-cli; skipping download."
    binary_path="${BIN_DIR}/whisper-cli"
else
    log "Downloading prebuilt whisper.cpp v${VERSION} binary."
    tmp_dir="$(mktemp -d)"
    trap 'rm -rf "${tmp_dir}"' EXIT
    zip_path="${tmp_dir}/whisper-cli.zip"

    if curl -L --fail "${BINARY_URL}" -o "${zip_path}"; then
        unzip -q "${zip_path}" -d "${tmp_dir}"
        binary_candidate="$(find "${tmp_dir}" -type f -name whisper-cli -perm -u+x | head -n 1 || true)"
        if [ -z "${binary_candidate}" ]; then
            log "Failed to locate whisper-cli binary in downloaded archive."
            exit 1
        fi

        log "Installing binary to ${BIN_DIR}/whisper-cli."
        install -m 0755 "${binary_candidate}" "${BIN_DIR}/whisper-cli"
        binary_path="${BIN_DIR}/whisper-cli"
    else
        log "Downloading whisper.cpp binary failed."
        exit 1
    fi
fi

log "Linking binary at ${BIN_LINK}."
ln -sf "${binary_path}" "${BIN_LINK}"

if [ -f "${BASE_MULTILINGUAL}" ]; then
    log "Multilingual model already present at ${BASE_MULTILINGUAL}; skipping download."
else
    log "Downloading multilingual base model to ${BASE_MULTILINGUAL}."
    curl -L --fail "${MODEL_URL}" -o "${BASE_MULTILINGUAL}"
fi

if [ -f "${BASE_ENGLISH}" ]; then
    log "English model already present at ${BASE_ENGLISH}; skipping download."
else
    log "Downloading English base model to ${BASE_ENGLISH}."
    curl -L --fail "${MODEL_EN_URL}" -o "${BASE_ENGLISH}"
fi

log "whisper.cpp installation complete. Models installed under ${MODEL_DIR}."
exit 0
