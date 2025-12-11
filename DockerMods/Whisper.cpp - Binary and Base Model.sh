# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp - Binary and Base Model
# Description: Installs the whisper.cpp binary with Vulkan support and downloads the ggml-base
#              multilingual and English models into /app/common/whispercpp/models.
# Author: Gas-X-ExtraStrength
# Revision: 2
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
VERSION="1.8.2"
BINARY_URL="https://github.com/natoriousbigg/whisper.cpp/releases/download/v${VERSION}/whisper-cli-v${VERSION}-ubuntu-x64-openblas-vulkan.zip"
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

log "Downloading prebuilt whisper.cpp v${VERSION} binary."
# Clean existing binaries to ensure fresh installation
if [ -d "${BIN_DIR}" ]; then
    log "Removing existing binaries from ${BIN_DIR}."
    rm -rf "${BIN_DIR}"
    mkdir -p "${BIN_DIR}"
fi

binary_path=""

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
zip_path="${tmp_dir}/whisper-cli.zip"

if curl -L --fail "${BINARY_URL}" -o "${zip_path}"; then
    log "Extracting archive and flattening nested zips..."
    extract_dir="${tmp_dir}/extracted"
    mkdir -p "${extract_dir}"
    unzip -q "${zip_path}" -d "${extract_dir}"
    rm -f "${zip_path}"
    
    # Recursively extract any nested zip files and flatten structure
    # Loop until no more zip files are found (handles deeply nested zips)
    while true; do
        nested_zip="$(find "${extract_dir}" -type f -name "*.zip" | head -n 1)"
        if [ -z "${nested_zip}" ]; then
            break
        fi
        log "Found nested zip: $(basename "${nested_zip}")"
        nested_extract="${extract_dir}/nested_tmp"
        mkdir -p "${nested_extract}"
        unzip -q "${nested_zip}" -d "${nested_extract}"
        rm -f "${nested_zip}"
        # Move contents up
        find "${nested_extract}" -mindepth 1 -exec mv {} "${extract_dir}/" \; 2>/dev/null || true
        rmdir "${nested_extract}" 2>/dev/null || true
    done
    
    log "Installing all content to ${BIN_DIR}..."
    # Copy all files from extracted directory to BIN_DIR
    while IFS= read -r -d '' file; do
        dest="${BIN_DIR}/$(basename "$file")"
        install -m 0644 "$file" "$dest"
    done < <(find "${extract_dir}" -type f -print0)
    
    # Make all files in bin directory executable (handles spaces in filenames)
    log "Making all files in ${BIN_DIR} executable..."
    find "${BIN_DIR}" -type f -exec chmod +x {} +
    
    # Verify whisper-cli binary was installed
    if [ ! -x "${BIN_DIR}/whisper-cli" ]; then
        log "Failed to locate whisper-cli binary in downloaded archive."
        exit 1
    fi
    
    binary_path="${BIN_DIR}/whisper-cli"
else
    log "Downloading whisper.cpp binary failed."
    exit 1
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
