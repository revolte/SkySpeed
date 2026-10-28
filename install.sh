#!/usr/bin/env bash
# ==============================================================================
#  ⚡ SkySpeed — 1-File Instant Installer for Linux & macOS
#  Install via:
#    curl -fsSL https://raw.githubusercontent.com/revolte/SkySpeed/main/install.sh | bash
#  Or run locally:
#    ./install.sh
# ==============================================================================

set -e

CYAN="\033[96m"
GREEN="\033[92m"
YELLOW="\033[93m"
BOLD="\033[1m"
DIM="\033[2m"
RESET="\033[0m"

echo -e "\n${BOLD}${CYAN}⚡ SkySpeed — Precision Speed Test Installer${RESET}"
echo -e "${DIM}====================================================${RESET}"

# 1. Check Python 3
if ! command -v python3 >/dev/null 2>&1; then
    echo -e "${YELLOW}Error: python3 is required but not installed.${RESET}"
    exit 1
fi

PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo -e "[${GREEN}✓${RESET}] Found Python ${BOLD}${PY_VER}${RESET}"

# 2. Target Directories
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/128x128/apps"

mkdir -p "${BIN_DIR}" "${APP_DIR}" "${ICON_DIR}"

TARGET_EXEC="${BIN_DIR}/skyspeed"
TARGET_ICON="${ICON_DIR}/skyspeed.png"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"

# 3. Install Executable
if [ -f "${SCRIPT_DIR}/skyspeed" ]; then
    echo -e "[1/3] Installing standalone executable from local repository..."
    cp -f "${SCRIPT_DIR}/skyspeed" "${TARGET_EXEC}"
elif [ -f "${SCRIPT_DIR}/app.py" ]; then
    echo -e "[1/3] Installing standalone executable from local app.py..."
    cp -f "${SCRIPT_DIR}/app.py" "${TARGET_EXEC}"
else
    echo -e "[1/3] Downloading standalone SkySpeed single-file from GitHub..."
    curl -fsSL "https://raw.githubusercontent.com/revolte/SkySpeed/main/skyspeed" -o "${TARGET_EXEC}" || \
    curl -fsSL "https://raw.githubusercontent.com/revolte/SkySpeed/main/app.py" -o "${TARGET_EXEC}"
fi

chmod +x "${TARGET_EXEC}"
echo -e "[${GREEN}✓${RESET}] Installed to ${BOLD}${TARGET_EXEC}${RESET}"

# 4. Install Icon
if [ -f "${SCRIPT_DIR}/static/logo.png" ]; then
    cp -f "${SCRIPT_DIR}/static/logo.png" "${TARGET_ICON}"
elif [ -f "${SCRIPT_DIR}/docs/logo.png" ]; then
    cp -f "${SCRIPT_DIR}/docs/logo.png" "${TARGET_ICON}"
else
    # Extract logo from embedded base64 in the executable
    python3 -c '
import base64, os
bin_path = os.path.expanduser("~/.local/bin/skyspeed")
icon_path = os.path.expanduser("~/.local/share/icons/hicolor/128x128/apps/skyspeed.png")
try:
    with open(bin_path, "r", encoding="utf-8") as f:
        content = f.read()
    import re
    m = re.search(r"EMBEDDED_LOGO_B64\s*=\s*\"([^\"]+)\"", content)
    if m:
        with open(icon_path, "wb") as f_out:
            f_out.write(base64.b64decode(m.group(1)))
except Exception:
    pass
' 2>/dev/null || true
fi

# 5. Create Desktop Menu Shortcut
cat << 'EOF' > "${APP_DIR}/skyspeed.desktop"
[Desktop Entry]
Name=SkySpeed
Comment=Internet Speed Test & Network Diagnostics
Exec=python3 %h/.local/bin/skyspeed --open
Icon=skyspeed
Terminal=false
Type=Application
Categories=Network;Utility;
StartupNotify=true
EOF

sed -i "s|%h|${HOME}|g" "${APP_DIR}/skyspeed.desktop"
chmod +x "${APP_DIR}/skyspeed.desktop"
update-desktop-database "${APP_DIR}" 2>/dev/null || true
echo -e "[${GREEN}✓${RESET}] Desktop shortcut created: ${BOLD}SkySpeed${RESET}"

# 6. Ensure ~/.local/bin is in PATH
SHELL_RC=""
if [ -n "$BASH_VERSION" ]; then
    SHELL_RC="${HOME}/.bashrc"
elif [ -n "$ZSH_VERSION" ]; then
    SHELL_RC="${HOME}/.zshrc"
else
    SHELL_RC="${HOME}/.profile"
fi

if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
    if [ -f "${SHELL_RC}" ] && ! grep -q 'PATH=.*\.local/bin' "${SHELL_RC}"; then
        echo -e '\nexport PATH="$HOME/.local/bin:$PATH"' >> "${SHELL_RC}"
    fi
    export PATH="${BIN_DIR}:$PATH"
fi
echo -e "[${GREEN}✓${RESET}] PATH verified (${BIN_DIR})"

# Done!
echo -e "\n${BOLD}${GREEN}====================================================${RESET}"
echo -e "${BOLD}${GREEN}  🎉 SkySpeed has been installed successfully!${RESET}"
echo -e "${BOLD}${GREEN}====================================================${RESET}"
echo -e "You can now run it from anywhere in your terminal:"
echo -e "  ${CYAN}skyspeed${RESET}         -> Launch Web UI (http://localhost:8080)"
echo -e "  ${CYAN}skyspeed --open${RESET}  -> Launch & auto-open in browser"
echo -e "  ${CYAN}skyspeed --cli${RESET}   -> Run instant speed test in terminal"
echo -e ""
echo -e "Or search ${BOLD}SkySpeed${RESET} in your Applications menu!\n"
