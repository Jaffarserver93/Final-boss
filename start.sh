#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AFK Dashboard Bot — PRoot Ubuntu Launch Script
#  Deep-compatible with: Termux PRoot-Distro Ubuntu, Debian ARM64/x86_64,
#  standard Linux VPS, Docker containers, and WSL2.
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
C='\033[0;36m'   BC='\033[1;36m'   G='\033[0;32m'   BG='\033[1;32m'
Y='\033[0;33m'   BY='\033[1;33m'   R='\033[0;31m'   BR='\033[1;31m'
M='\033[0;35m'   BM='\033[1;35m'   W='\033[1;37m'   RST='\033[0m'

# ── Banner ───────────────────────────────────────────────────────────────────
clear 2>/dev/null || true
echo -e "${BC}╔═══════════════════════════════════════════════════════════════╗${RST}"
echo -e "${BC}║        ___   _______ _  __   ___   ___ _____                  ║${RST}"
echo -e "${BC}║       / _ | / __/ _ / |/ /  / _ ) / _ /_  __/                 ║${RST}"
echo -e "${BC}║      / __ |/ _// , _/    /  / _  |/ _  |/ /                   ║${RST}"
echo -e "${BC}║     /_/ |_/_/ /_/|_/_/|_/  /____//___//_/                     ║${RST}"
echo -e "${BC}║                                                                ║${RST}"
echo -e "${BM}║      AFK Dashboard Engine v1.2 — PRoot Ubuntu Launcher         ║${RST}"
echo -e "${BC}╚═══════════════════════════════════════════════════════════════╝${RST}"
echo ""

# ── Helper utilities ─────────────────────────────────────────────────────────
step() { echo -e "\n${BC}[STEP $1]${RST} ${W}$2${RST}"; }
ok()   { echo -e "  ${BG}✔${RST}  $1"; }
warn() { echo -e "  ${BY}⚠${RST}   $1"; }
info() { echo -e "  ${C}›${RST}  $1"; }
err()  { echo -e "  ${BR}✖${RST}  $1" >&2; }
die()  { err "$1"; exit 1; }

has() { command -v "$1" &>/dev/null; }

# ── Detect architecture ───────────────────────────────────────────────────────
ARCH=$(uname -m)
IS_ARM=false
case "$ARCH" in
  aarch64|arm64|armv8*) IS_ARM=true ;;
  armv7*)               IS_ARM=true ;;
esac
ok "Architecture: ${ARCH}$(${IS_ARM} && echo ' (ARM — extra fixes active)' || echo '')"

# ── Detect OS / package manager ───────────────────────────────────────────────
PM=""
if has apt-get;   then PM="apt"; fi
if has apt;       then PM="apt"; fi
if has apk;       then PM="apk"; fi
if has dnf;       then PM="dnf"; fi
if has pacman;    then PM="pacman"; fi
ok "Package manager: ${PM:-none detected}"

# ── Elevate helper (sudo or direct if root) ───────────────────────────────────
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if has sudo; then SUDO="sudo"; else
    warn "Not root and sudo not found — some install steps may fail."
  fi
fi

apt_install() {
  [ "$PM" = "apt" ] || return 0
  local pkgs=("$@")
  local missing=()
  for p in "${pkgs[@]}"; do
    dpkg -s "$p" &>/dev/null 2>&1 || missing+=("$p")
  done
  if [ ${#missing[@]} -eq 0 ]; then return 0; fi
  info "Installing system packages: ${missing[*]}"
  $SUDO apt-get update -qq 2>/dev/null || $SUDO apt-get update || true
  $SUDO apt-get install -y "${missing[@]}" || \
    warn "Could not install some packages — continuing anyway."
}

# ═════════════════════════════════════════════════════════════════════════════
step "1/7" "Checking write access & directory health"
# ═════════════════════════════════════════════════════════════════════════════

touch .write_test 2>/dev/null || die "No write permission in $PWD. Run: chmod -R 777 $PWD"
rm -f .write_test

# Symlink test — Android /sdcard does NOT support symlinks (FAT32/exFAT)
if ! ln -s /dev/null .sym_test 2>/dev/null; then
  warn "Symlinks NOT supported in this directory."
  warn "This usually means you're running from /sdcard (Android shared storage)."
  warn "npm requires symlink support. Copy the project into the PRoot home first:"
  echo -e "    ${C}cp -r \$(pwd) ~/bot && cd ~/bot${RST}"
  read -rp "$(echo -e "${BY}Ignore this warning and try anyway? (y/N): ${RST}")" SYM_SKIP
  [[ "$SYM_SKIP" =~ ^[Yy]$ ]] || exit 1
else
  rm -f .sym_test
  ok "Write access and symlinks are supported."
fi

# ═════════════════════════════════════════════════════════════════════════════
step "2/7" "Installing system-level dependencies"
# ═════════════════════════════════════════════════════════════════════════════

# Core build tools
apt_install curl wget ca-certificates gnupg unzip tar xz-utils git build-essential

# ── Node.js ──────────────────────────────────────────────────────────────────
NODE_MIN_MAJOR=18
if has node; then
  NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
  if [ "$NODE_MAJOR" -lt "$NODE_MIN_MAJOR" ]; then
    warn "Node.js v${NODE_MAJOR} is too old (need v${NODE_MIN_MAJOR}+). Installing via NodeSource..."
    has_new_node=false
  else
    ok "Node.js $(node -v) detected."
    has_new_node=true
  fi
else
  warn "Node.js not found."
  has_new_node=false
fi

if ! $has_new_node; then
  if [ "$PM" = "apt" ]; then
    # NodeSource setup — works on ARM64 and x86_64
    info "Setting up NodeSource repository for Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - 2>/dev/null || \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null || true
    $SUDO apt-get install -y nodejs 2>/dev/null || apt-get install -y nodejs 2>/dev/null || true
  fi

  # Fallback: NVM (works on any arch, no root needed)
  if ! has node || [ "$(node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null)" -lt "$NODE_MIN_MAJOR" ]; then
    warn "NodeSource install failed or skipped. Trying NVM fallback..."
    export NVM_DIR="${HOME}/.nvm"
    if [ ! -d "$NVM_DIR" ]; then
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>/dev/null || true
    fi
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" || true
    if has nvm; then
      nvm install 20 2>/dev/null && nvm use 20 2>/dev/null && nvm alias default 20 2>/dev/null || true
    fi
  fi

  has node || die "Could not install Node.js. Please install manually: https://nodejs.org"
  ok "Node.js $(node -v) is ready."
fi

has npm || die "npm not found. It should come with Node.js."
ok "npm $(npm -v) detected."

# ── Chromium ─────────────────────────────────────────────────────────────────
CHROMIUM_PATH=""
for bin in chromium-browser chromium chromium-bsu google-chrome google-chrome-stable; do
  if has "$bin"; then
    CHROMIUM_PATH=$(command -v "$bin")
    ok "Chromium found at: ${CHROMIUM_PATH}"
    break
  fi
done

if [ -z "$CHROMIUM_PATH" ]; then
  warn "Chromium not found. Installing..."
  if [ "$PM" = "apt" ]; then
    # ARM64: 'chromium' is the correct package name on Ubuntu/Debian ARM
    if $IS_ARM; then
      $SUDO apt-get install -y chromium 2>/dev/null || \
      $SUDO apt-get install -y chromium-browser 2>/dev/null || true
    else
      $SUDO apt-get install -y chromium-browser 2>/dev/null || \
      $SUDO apt-get install -y chromium 2>/dev/null || true
    fi
  fi
  for bin in chromium-browser chromium google-chrome; do
    if has "$bin"; then CHROMIUM_PATH=$(command -v "$bin"); break; fi
  done
  if [ -z "$CHROMIUM_PATH" ]; then
    warn "Chromium install failed. Puppeteer will run in simulated fallback mode."
    warn "To fix: apt install chromium  (or chromium-browser)"
  else
    ok "Chromium installed at: ${CHROMIUM_PATH}"
  fi
fi

# ── esbuild (ARM64 Bus Error fix) ─────────────────────────────────────────────
# The npm-bundled esbuild binary is compiled for x86_64 with 4 KB page alignment.
# ARM64 Linux kernels use 16 KB pages — executing the x86_64 binary causes
# "Bus error (core dumped)".  Install the system-native esbuild as the fix.
ESBUILD_SYS=""
for p in /usr/bin/esbuild /usr/local/bin/esbuild; do
  [ -x "$p" ] && ESBUILD_SYS="$p" && break
done

if $IS_ARM && [ -z "$ESBUILD_SYS" ]; then
  warn "ARM64: system esbuild not found — installing to prevent Bus Error in Vite..."
  if [ "$PM" = "apt" ]; then
    $SUDO apt-get install -y esbuild 2>/dev/null || true
  fi
  # If apt esbuild is too old or missing, install via npm globally
  if ! has esbuild || [ -z "$ESBUILD_SYS" ]; then
    npm install -g esbuild 2>/dev/null || true
  fi
  for p in /usr/bin/esbuild /usr/local/bin/esbuild $(npm root -g 2>/dev/null)/esbuild/bin/esbuild; do
    [ -x "$p" ] && ESBUILD_SYS="$p" && break
  done
fi

if [ -n "$ESBUILD_SYS" ]; then
  export ESBUILD_BINARY_PATH="$ESBUILD_SYS"
  ok "esbuild path pinned: ${ESBUILD_SYS}"
elif $IS_ARM; then
  warn "No system esbuild found. Vite may crash with Bus Error on ARM64."
  warn "Fix: apt install esbuild  OR  npm install -g esbuild"
fi

# ── Other useful tools ────────────────────────────────────────────────────────
apt_install procps psmisc lsof 2>/dev/null || true

# ═════════════════════════════════════════════════════════════════════════════
step "3/7" "Configuring environment (.env)"
# ═════════════════════════════════════════════════════════════════════════════

# Bootstrap from template if .env doesn't exist
if [ ! -f .env ]; then
  [ -f .env.example ] && cp .env.example .env || touch .env
  ok "Created .env from template."
fi

# Read existing values (safe even if keys are absent)
_env_get() { grep "^${1}=" .env 2>/dev/null | cut -d'=' -f2- | tr -d '"'"'" | xargs 2>/dev/null || true; }
_env_set() {
  local key="$1" val="$2"
  # Remove existing line then append
  grep -v "^${key}=" .env > .env.tmp 2>/dev/null && mv .env.tmp .env || true
  echo "${key}=\"${val}\"" >> .env
}

EX_EMAIL=$(_env_get VEKTAL_EMAIL)
EX_PASS=$(_env_get VEKTAL_PASSWORD)
EX_PORT=$(_env_get PORT)
EX_GEMINI=$(_env_get GEMINI_API_KEY)
EX_PORT="${EX_PORT:-3000}"

if [ -n "$EX_EMAIL" ] && [ -n "$EX_PASS" ]; then
  ok "Existing credentials found — skipping prompts."
  info "  Email : $EX_EMAIL"
  info "  Port  : $EX_PORT"
  NEW_EMAIL="$EX_EMAIL"
  NEW_PASS="$EX_PASS"
  NEW_GEMINI="$EX_GEMINI"
  NEW_PORT="$EX_PORT"
else
  echo -e "\n${BY}  Provide your Vektal Nodes credentials (stored only in .env):${RST}"

  # Email
  while true; do
    read -rp "$(echo -e "${BC}  ▸ Vektal Email${EX_EMAIL:+ [${EX_EMAIL}]}: ${RST}")" NEW_EMAIL
    NEW_EMAIL="${NEW_EMAIL:-$EX_EMAIL}"
    [ -n "$NEW_EMAIL" ] && break
    err "Email cannot be empty."
  done

  # Password (hidden)
  while true; do
    read -rsp "$(echo -e "${BC}  ▸ Vektal Password${EX_PASS:+ [keep existing]}: ${RST}")" NEW_PASS
    echo
    NEW_PASS="${NEW_PASS:-$EX_PASS}"
    [ -n "$NEW_PASS" ] && break
    err "Password cannot be empty."
  done

  # Gemini (optional)
  read -rp "$(echo -e "${BC}  ▸ Gemini API Key (optional): ${RST}")" NEW_GEMINI
  NEW_GEMINI="${NEW_GEMINI:-$EX_GEMINI}"

  # Port
  read -rp "$(echo -e "${BC}  ▸ Dashboard Port [${EX_PORT}]: ${RST}")" NEW_PORT
  NEW_PORT="${NEW_PORT:-$EX_PORT}"

  # Persist
  _env_set VEKTAL_EMAIL  "$NEW_EMAIL"
  _env_set VEKTAL_PASSWORD "$NEW_PASS"
  _env_set PORT          "$NEW_PORT"
  [ -n "$NEW_GEMINI" ] && _env_set GEMINI_API_KEY "$NEW_GEMINI"
  ok "Credentials saved to .env."
fi

# ═════════════════════════════════════════════════════════════════════════════
step "4/7" "Configuring npm for PRoot / root environments"
# ═════════════════════════════════════════════════════════════════════════════

# Root / PRoot containers report UID 0.  npm by default refuses lifecycle scripts
# as root (security measure designed for real multi-user systems, not containers).
if [ "$(id -u)" -eq 0 ]; then
  npm config set user 0             2>/dev/null || true
  npm config set unsafe-perm true   2>/dev/null || true
  ok "npm root-user safe mode enabled (unsafe-perm=true)."
fi

# ARM64: pin the system-native esbuild for npm scripts too
if [ -n "${ESBUILD_BINARY_PATH:-}" ]; then
  npm config set ESBUILD_BINARY_PATH "$ESBUILD_BINARY_PATH" 2>/dev/null || true
fi

# ═════════════════════════════════════════════════════════════════════════════
step "5/7" "Installing Node.js dependencies"
# ═════════════════════════════════════════════════════════════════════════════

export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

info "Running npm install (Puppeteer Chromium download skipped)..."

NPM_INSTALL_OK=false
for attempt in \
  "npm install --unsafe-perm=true --legacy-peer-deps" \
  "npm install --unsafe-perm=true --legacy-peer-deps --no-audit --no-fund" \
  "npm install --legacy-peer-deps"; do
  if eval "PUPPETEER_SKIP_DOWNLOAD=true $attempt" 2>&1; then
    NPM_INSTALL_OK=true
    break
  fi
  warn "Attempt failed, retrying with different flags..."
done

$NPM_INSTALL_OK || die "npm install failed after all retries. Check the output above."
ok "All dependencies installed successfully."

# ═════════════════════════════════════════════════════════════════════════════
step "6/7" "Applying proot-specific runtime patches"
# ═════════════════════════════════════════════════════════════════════════════

# Re-export ESBUILD_BINARY_PATH (may have been set in step 2 before npm install)
if [ -n "${ESBUILD_BINARY_PATH:-}" ]; then
  export ESBUILD_BINARY_PATH
  ok "ESBUILD_BINARY_PATH exported: $ESBUILD_BINARY_PATH"
else
  # Try one more time after npm install (npm may have installed its own)
  for p in /usr/bin/esbuild /usr/local/bin/esbuild; do
    [ -x "$p" ] && export ESBUILD_BINARY_PATH="$p" && ok "ESBUILD found post-install: $p" && break
  done
fi

# Export Chromium path so Puppeteer can find it without downloading
if [ -n "$CHROMIUM_PATH" ]; then
  export PUPPETEER_EXECUTABLE_PATH="$CHROMIUM_PATH"
  ok "PUPPETEER_EXECUTABLE_PATH set: $CHROMIUM_PATH"
else
  warn "No Chromium found — bot will run in SIMULATED mode (no live browser)."
fi

# Verify port is free
PORT_IN_USE=false
if has lsof; then
  lsof -ti:"${NEW_PORT}" &>/dev/null 2>&1 && PORT_IN_USE=true || true
elif has ss; then
  ss -ltn | grep -q ":${NEW_PORT}" && PORT_IN_USE=true || true
fi
if $PORT_IN_USE; then
  warn "Port ${NEW_PORT} is already in use."
  read -rp "$(echo -e "${BY}  Kill existing process on :${NEW_PORT}? (y/N): ${RST}")" KILL_PORT
  if [[ "$KILL_PORT" =~ ^[Yy]$ ]]; then
    if has lsof; then
      kill "$(lsof -ti:"${NEW_PORT}")" 2>/dev/null || true
    fi
    ok "Killed process on port ${NEW_PORT}."
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
step "7/7" "Choose launch profile"
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "  ${BG}1)${RST} ${W}DEVELOPMENT MODE${RST}   — Live tsx reload, Vite HMR, fastest iteration"
echo -e "  ${BG}2)${RST} ${W}PRODUCTION MODE${RST}    — vite build + optimised node server"
echo -e "  ${BG}3)${RST} ${W}BUILD ONLY${RST}         — Compile frontend to ./dist and exit"
echo -e "  ${BG}4)${RST} ${W}EXIT${RST}               — Setup complete, exit without launching"
echo ""

read -rp "$(echo -e "${BC}  ▸ Select profile (1-4) [default: 1]: ${RST}")" CHOICE
CHOICE="${CHOICE:-1}"

launch_dev() {
  echo -e "\n${BY}  🚀 Launching DEVELOPMENT server on port ${NEW_PORT}...${RST}"
  echo -e "  ${C}Open: http://localhost:${NEW_PORT}${RST}\n"
  PORT="${NEW_PORT}" \
  PUPPETEER_SKIP_DOWNLOAD=true \
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
  ${PUPPETEER_EXECUTABLE_PATH:+PUPPETEER_EXECUTABLE_PATH="$PUPPETEER_EXECUTABLE_PATH"} \
  ${ESBUILD_BINARY_PATH:+ESBUILD_BINARY_PATH="$ESBUILD_BINARY_PATH"} \
  npm run dev
}

launch_prod_build() {
  echo -e "\n${BY}  ⚙  Building production bundle...${RST}"
  PUPPETEER_SKIP_DOWNLOAD=true \
  ${ESBUILD_BINARY_PATH:+ESBUILD_BINARY_PATH="$ESBUILD_BINARY_PATH"} \
  npm run build
}

launch_prod_start() {
  echo -e "\n${BY}  🚀 Starting PRODUCTION server on port ${NEW_PORT}...${RST}"
  echo -e "  ${C}Open: http://localhost:${NEW_PORT}${RST}\n"
  PORT="${NEW_PORT}" \
  NODE_ENV=production \
  PUPPETEER_SKIP_DOWNLOAD=true \
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
  ${PUPPETEER_EXECUTABLE_PATH:+PUPPETEER_EXECUTABLE_PATH="$PUPPETEER_EXECUTABLE_PATH"} \
  npm start
}

case $CHOICE in
  1)
    launch_dev
    ;;
  2)
    if launch_prod_build; then
      ok "Build succeeded."
      launch_prod_start
    else
      err "Build failed — see errors above."
      echo -e "\n${BY}  Common fixes on proot/ARM64:${RST}"
      echo -e "  ${C}› apt install esbuild${RST}  (ARM64 Bus Error fix)"
      echo -e "  ${C}› apt install chromium${RST}  (Puppeteer target)"
      echo -e "  ${C}› Make sure you are NOT running from /sdcard${RST}"
      exit 1
    fi
    ;;
  3)
    if launch_prod_build; then
      ok "Build complete! Output is in ./dist"
      echo -e "  Run the server manually: ${C}PORT=${NEW_PORT} npm start${RST}"
    else
      err "Build failed — see errors above."
      exit 1
    fi
    ;;
  *)
    echo ""
    ok "Setup complete. You can start the bot manually with:"
    echo -e "  ${C}Development : PORT=${NEW_PORT} npm run dev${RST}"
    echo -e "  ${C}Production  : npm run build && PORT=${NEW_PORT} npm start${RST}"
    echo ""
    ;;
esac
