# ----------------------------------------------------------------------------------------------------
# Name: SubtitleEdit - Binary and CLI
# Description: Installs SubtitleEdit CLI (self-contained) for professional SRT subtitle post-processing.
#              Provides tools for fixing common errors, removing formatting, HI text removal, and more.
# Author: natoriousbigg
# Revision: 3
# Icon: https://raw.githubusercontent.com/SubtitleEdit/subtitleedit/main/src/ui/Icons/SE.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -eu

log() {
    echo "[subtitleedit] $1" >&2
}

INSTALL_ROOT="/app/common/subtitleedit"
BIN_LINK="/usr/local/bin/seconv"
REPO_URL="https://github.com/SubtitleEdit/subtitleedit-cli.git"

if [ "${1:-}" = "--uninstall" ]; then
    log "Uninstall flag detected. Removing SubtitleEdit installation..."
    rm -f "${BIN_LINK}" || true
    rm -rf "${INSTALL_ROOT}" || true
    log "Uninstall complete."
    exit 0
fi

log "Starting SubtitleEdit CLI installation."

# Check and install dependencies
packages=()

if ! command -v git >/dev/null 2>&1; then
    log "git not found. Adding to install list."
    packages+=(git)
fi

if ! command -v wget >/dev/null 2>&1; then
    log "wget not found. Adding to install list."
    packages+=(wget)
fi

if [ ${#packages[@]} -gt 0 ]; then
    log "Installing dependencies: ${packages[*]}"
    apt-get -qq update
    apt-get install -yqq "${packages[@]}" ca-certificates
fi

# Install .NET 8 SDK if not already present
if ! dotnet --list-sdks 2>/dev/null | grep -q "8.0"; then
    log ".NET 8 SDK not found. Installing..."
    dotnet_tmp_dir="$(mktemp -d)"
    
    wget -q https://dot.net/v1/dotnet-install.sh -O "${dotnet_tmp_dir}/dotnet-install.sh"
    bash "${dotnet_tmp_dir}/dotnet-install.sh" -c 8.0 --install-dir /dotnet
    
    # Add dotnet to PATH
    export PATH="/dotnet:$PATH"
    
    rm -rf "${dotnet_tmp_dir}"
    log ".NET 8 SDK installation complete."
else
    log ".NET 8 SDK already installed."
fi

log "Creating directory structure at ${INSTALL_ROOT}."
mkdir -p "${INSTALL_ROOT}"

# Clone and build SubtitleEdit CLI from source
log "Cloning SubtitleEdit CLI repository."
build_dir="$(mktemp -d)"
trap 'rm -rf "${build_dir}"' EXIT

if ! git clone --depth 1 "${REPO_URL}" "${build_dir}/subtitleedit-cli"; then
    log "ERROR: Failed to clone SubtitleEdit CLI repository."
    exit 1
fi

# Build SubtitleEdit CLI
log "Building SubtitleEdit CLI from source."
project_file="${build_dir}/subtitleedit-cli/src/se-cli/seconv.csproj"
if [ ! -f "${project_file}" ]; then
    log "ERROR: Project file not found at ${project_file}"
    exit 1
fi

if ! dotnet publish "${project_file}" \
    -c Release \
    -o "${INSTALL_ROOT}" \
    --self-contained true \
    -r linux-x64 \
    /p:PublishSingleFile=true \
    /p:PublishTrimmed=true; then
    log "ERROR: Failed to build SubtitleEdit CLI."
    exit 1
fi

# Verify se-cli binary exists
if [ ! -f "${INSTALL_ROOT}/seconv" ]; then
    log "ERROR: seconv binary not found after build."
    exit 1
fi

# Make binary executable
chmod +x "${INSTALL_ROOT}/seconv"

# Create symlink to seconv binary
log "Creating symlink at ${BIN_LINK}."
ln -sf "${INSTALL_ROOT}/seconv" "${BIN_LINK}"

# Verify installation
if [ -x "${BIN_LINK}" ] && "${BIN_LINK}" /help >/dev/null 2>&1; then
    log "SubtitleEdit CLI installation complete and verified."
    log "Usage: seconv <pattern> <format> [/options]"
else
    log "WARNING: Installation completed but verification failed."
fi

exit 0
