# ----------------------------------------------------------------------------------------------------
# Name: Whisper.cpp - Binary and Models
# Description: Installs the whisper.cpp binary (auto-detects GPU type and CPU capabilities) and downloads the ggml-base
#              multilingual model (for language detection), ggml-large-v3-turbo model (for transcription), and the Silero VAD 
#              model into /app/common/whispercpp/models. Sets HOME=/temp to prevent shader cache permission errors.
# Author: Gas-X-ExtraStrength
# Revision: 7
# Icon: https://meta-l.cdn.bubble.io/cdn-cgi/image/w=64,h=64,f=auto,dpr=2,fit=contain/f1695308256768x626644891139990000/open-ai.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -eu

log() {
    echo "[whisper.cpp] $1" >&2
}

# Set HOME to /temp to avoid shader cache permission errors
export HOME=/temp
mkdir -p /temp
chmod 777 /temp
log "Set HOME=/temp for shader cache and temp file writes."

INSTALL_ROOT="/app/common/whispercpp"
BIN_DIR="${INSTALL_ROOT}/bin"
MODEL_DIR="${INSTALL_ROOT}/models"
BASE_MULTILINGUAL="${MODEL_DIR}/ggml-base.bin"
BIN_LINK="/usr/local/bin/whisper-cli"
VERSION="1.8.2"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"

if [ "${1:-}" = "--uninstall" ]; then
    log "Uninstall flag detected. Removing whisper.cpp binaries and models..."
    rm -f "${BIN_LINK}" || true
    rm -rf "${INSTALL_ROOT}"
    rm -f "${BASE_MULTILINGUAL}" || true
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

if ! command -v lspci >/dev/null 2>&1; then
    log "pciutils not found. Installing pciutils for GPU detection."
    packages+=(pciutils)
fi

if [ ${#packages[@]} -gt 0 ]; then
    apt-get -qq update
    apt-get install -yqq "${packages[@]}"
fi

# Detect GPU and CPU capabilities to choose appropriate binary
detect_binary_type() {
    # 1. Check for Nvidia GPU → CUDA
    if command -v nvidia-smi >/dev/null 2>&1; then
        if nvidia-smi >/dev/null 2>&1; then
            log "Nvidia GPU detected. Will use CUDA-accelerated binary."
            echo "cuda"
            return
        fi
    fi
    
    # 2. Check for Intel or AMD GPU → Vulkan
    # Check for Intel GPU (integrated or discrete, including Arc)
    if lspci 2>/dev/null | grep -iE "VGA.*Intel|Display.*Intel|Intel Corporation.*Graphics" >/dev/null 2>&1; then
        log "Intel GPU detected. Will use Vulkan binary."
        echo "vulkan"
        return
    fi
    
    # Check for AMD GPU (including modern naming conventions)
    if lspci 2>/dev/null | grep -iE "VGA.*AMD|VGA.*ATI|Display.*AMD|Display.*ATI|AMD.*Graphics|ATI.*Graphics" >/dev/null 2>&1; then
        log "AMD GPU detected. Will use Vulkan binary."
        echo "vulkan"
        return
    fi
    
    # 3. Check for AVX512 support in CPU (case-insensitive) → Vulkan
    if grep -iq avx512 /proc/cpuinfo 2>/dev/null; then
        log "AVX512 CPU support detected. Will use Vulkan binary."
        echo "vulkan"
        return
    fi
    
    # 4. No GPU and no AVX512 → NoAVX512
    log "No GPU or AVX512 support detected. Will use NoAVX512 binary."
    echo "noavx512"
}

BINARY_TYPE=$(detect_binary_type)
BINARY_URL="https://github.com/natoriousbigg/whisper.cpp/releases/download/v${VERSION}/whisper-cli-v${VERSION}-ubuntu-x64-${BINARY_TYPE}.zip"

log "Downloading prebuilt whisper.cpp v${VERSION} binary (${BINARY_TYPE})."
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
    log "Multilingual base model already present at ${BASE_MULTILINGUAL}; skipping download."
else
    log "Downloading multilingual base model to ${BASE_MULTILINGUAL} (used for language detection)."
    curl -L --fail "${MODEL_URL}" -o "${BASE_MULTILINGUAL}"
fi

# Download large-v3-turbo model for transcription
LARGE_V3_TURBO="${MODEL_DIR}/ggml-distil-large-v3.bin"
LARGE_V3_TURBO_URL="https://huggingface.co/distil-whisper/distil-large-v3-ggml/resolve/main/ggml-distil-large-v3.bin"

if [ -f "${LARGE_V3_TURBO}" ]; then
    log "Large V3 Turbo model already present at ${LARGE_V3_TURBO}; skipping download."
else
    log "Downloading large-v3-turbo model to ${LARGE_V3_TURBO} (used for transcription)."
    curl -L --fail "${LARGE_V3_TURBO_URL}" -o "${LARGE_V3_TURBO}"
fi

# Download Silero VAD model
VAD_MODEL_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"
VAD_MODEL_PATH="${MODEL_DIR}/ggml-silero-v6.2.0.bin"

if [ -f "${VAD_MODEL_PATH}" ]; then
    log "Silero VAD model already present at ${VAD_MODEL_PATH}; skipping download."
else
    log "Downloading Silero VAD model."
    curl -L --fail "${VAD_MODEL_URL}" -o "${VAD_MODEL_PATH}"
fi

log "whisper.cpp installation complete. Models installed under ${MODEL_DIR}."
exit 0
