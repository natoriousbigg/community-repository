# ----------------------------------------------------------------------------------------------------
# Name: SubtitleEdit - Binary and CLI
# Description: Installs SubtitleEdit CLI with .NET runtime for professional SRT subtitle post-processing.
#              Provides tools for fixing common errors, removing formatting, HI text removal, and more.
# Author: natoriousbigg
# Revision: 1
# Icon: https://raw.githubusercontent.com/SubtitleEdit/subtitleedit/main/src/ui/Icons/SE.png
# ----------------------------------------------------------------------------------------------------

#!/bin/bash
set -eu

log() {
    echo "[subtitleedit] $1" >&2
}

INSTALL_ROOT="/app/common/subtitleedit"
BIN_DIR="${INSTALL_ROOT}/bin"
WRAPPER_SCRIPT="${BIN_DIR}/subtitleedit"
BIN_LINK="/usr/local/bin/subtitleedit"
VERSION="0.2.1"
DOWNLOAD_URL="https://github.com/SubtitleEdit/subtitleedit-cli/releases/download/${VERSION}/se-cli-${VERSION}-linux-x64.tar.gz"

if [ "${1:-}" = "--uninstall" ]; then
    log "Uninstall flag detected. Removing SubtitleEdit installation..."
    rm -f "${BIN_LINK}" || true
    rm -rf "${INSTALL_ROOT}" || true
    log "Uninstall complete."
    exit 0
fi

log "Starting SubtitleEdit CLI installation (version ${VERSION})."

# Check and install dependencies
packages=()

if ! command -v wget >/dev/null 2>&1; then
    log "wget not found. Adding to install list."
    packages+=(wget)
fi

if ! command -v tar >/dev/null 2>&1; then
    log "tar not found. Adding to install list."
    packages+=(tar)
fi

if [ ${#packages[@]} -gt 0 ]; then
    log "Installing dependencies: ${packages[*]}"
    apt-get -qq update
    apt-get install -yqq "${packages[@]}" ca-certificates
fi

log "Creating directory structure at ${INSTALL_ROOT}."
mkdir -p "${INSTALL_ROOT}" "${BIN_DIR}"

# Download SubtitleEdit CLI
log "Downloading SubtitleEdit CLI version ${VERSION} from GitHub."
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
tar_path="${tmp_dir}/subtitleedit-cli.tar.gz"

if ! wget -q --show-progress "${DOWNLOAD_URL}" -O "${tar_path}"; then
    log "ERROR: Failed to download SubtitleEdit CLI from ${DOWNLOAD_URL}"
    exit 1
fi

# Extract SubtitleEdit CLI
log "Extracting SubtitleEdit CLI to ${INSTALL_ROOT}."
if ! tar -xzf "${tar_path}" -C "${INSTALL_ROOT}" --strip-components=1; then
    log "ERROR: Failed to extract SubtitleEdit CLI archive."
    exit 1
fi

# Verify se-cli binary exists
if [ ! -f "${INSTALL_ROOT}/se-cli" ]; then
    log "ERROR: se-cli binary not found after extraction."
    exit 1
fi

# Make binary executable
chmod +x "${INSTALL_ROOT}/se-cli"

# Create wrapper script
log "Creating wrapper script at ${WRAPPER_SCRIPT}."
cat > "${WRAPPER_SCRIPT}" << 'EOF'
#!/bin/bash
# SubtitleEdit CLI wrapper script
exec /app/common/subtitleedit/se-cli "$@"
EOF

chmod +x "${WRAPPER_SCRIPT}"

# Create symlink
log "Creating symlink at ${BIN_LINK}."
ln -sf "${WRAPPER_SCRIPT}" "${BIN_LINK}"

# Verify installation
if [ -x "${BIN_LINK}" ] && "${BIN_LINK}" --help >/dev/null 2>&1; then
    log "SubtitleEdit CLI installation complete and verified."
    log "Usage: subtitleedit [options]"
else
    log "WARNING: Installation completed but verification failed."
fi

exit 0
