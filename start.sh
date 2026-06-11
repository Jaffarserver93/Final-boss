#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AFK Dashboard Bot — PRoot Ubuntu Launch Script
#  Compatible with: Termux PRoot-Distro Ubuntu, Debian ARM64/x86_64,
#  standard Linux VPS, Docker containers, WSL2.
# ═══════════════════════════════════════════════════════════════════════════════

# NOTE: -e (exit on error) intentionally omitted — we handle every error manually
# so the script never bails silently on a sub-command returning non-zero.
set -uo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
C='\033[0;36m'  BC='\033[1;36m'  G='\033[0;32m'  BG='\033[1;32m'
Y='\033[0;33m'  BY='\033[1;33m'  R='\033[0;31m'  BR='\033[1;31m'
BM='\033[1;35m' W='\033[1;37m'   RST='\033[0m'

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

# ── Helpers ───────────────────────────────────────────────────────────────────
step() { echo -e "\n${BC}[STEP $1]${RST} ${W}$2${RST}"; }
ok()   { echo -e "  ${BG}✔${RST}  $1"; }
warn() { echo -e "  ${BY}⚠${RST}   $1"; }
info() { echo -e "  ${C}›${RST}  $1"; }
err()  { echo -e "  ${BR}✖${RST}  $1"; }
die()  { err "$1"; exit 1; }
has()  { command -v "$1" &>/dev/null; }

# ── Architecture ──────────────────────────────────────────────────────────────
ARCH=$(uname -m)
IS_ARM=false
case "$ARCH" in aarch64|arm64|armv8*|armv7*) IS_ARM=true ;; esac
if $IS_ARM; then
  ok "Architecture: ${ARCH} (ARM — extra fixes active)"
else
  ok "Architecture: ${ARCH}"
fi

# ── Package manager ───────────────────────────────────────────────────────────
PM=""
has apt-get && PM="apt"
has apt     && PM="apt"
has apk     && PM="apk"
has dnf     && PM="dnf"
has pacman  && PM="pacman"
ok "Package manager: ${PM:-none detected}"

# ── Privilege helper ──────────────────────────────────────────────────────────
# In proot containers you are typically root (UID 0); sudo is usually absent.
# We call install commands directly if root, prefix with sudo otherwise.
run_priv() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif has sudo; then
    sudo "$@"
  else
    warn "Not root and no sudo — trying without privilege escalation: $*"
    "$@" || true
  fi
}

apt_install() {
  [ "$PM" = "apt" ] || return 0
  local missing=()
  for p in "$@"; do
    dpkg -s "$p" &>/dev/null 2>&1 || missing+=("$p")
  done
  [ ${#missing[@]} -eq 0 ] && return 0
  info "apt: installing ${missing[*]} ..."
  run_priv apt-get update -qq 2>/dev/null || run_priv apt-get update 2>/dev/null || true
  run_priv apt-get install -y "${missing[@]}" 2>&1 || \
    warn "Could not install ${missing[*]} — continuing anyway."
}

# ═════════════════════════════════════════════════════════════════════════════
step "1/7" "Checking write access & directory health"
# ═════════════════════════════════════════════════════════════════════════════

# Auto-fix permissions — common when a repo is cloned as a different user
# or when the proot filesystem was created with restrictive umask.
if ! touch .write_test 2>/dev/null; then
  warn "No write permission in $PWD — attempting auto-fix..."
  chmod -R 755 . 2>/dev/null || true
  chown -R "$(id -u):$(id -g)" . 2>/dev/null || true
  if ! touch .write_test 2>/dev/null; then
    chmod -R 777 . 2>/dev/null || true
  fi
  if ! touch .write_test 2>/dev/null; then
    die "Still no write permission after auto-fix. Are you on /sdcard? Move to ~/bot first:\n    cp -r \$(pwd) ~/bot && cd ~/bot"
  fi
  ok "Permissions auto-fixed."
fi
rm -f .write_test

# Symlink test — Android /sdcard (FAT32/exFAT) silently rejects symlinks;
# npm install will create thousands of symlinks and fail completely there.
if ! ln -s /dev/null .sym_test 2>/dev/null; then
  warn "Symlinks are NOT supported in this directory."
  warn "This almost always means you're running from /sdcard (Android shared storage)."
  warn "Move the project into the PRoot home and try again:"
  echo -e "    ${C}cp -r \$(pwd) ~/bot && cd ~/bot && bash start.sh${RST}"
  read -rp "$(echo -e "${BY}  Try anyway? (y/N): ${RST}")" _sym || _sym="n"
  [[ "$_sym" =~ ^[Yy]$ ]] || exit 1
else
  rm -f .sym_test
  ok "Write access and symlinks confirmed."
fi

# ═════════════════════════════════════════════════════════════════════════════
step "2/7" "Installing system-level dependencies"
# ═════════════════════════════════════════════════════════════════════════════

# Basic build + network tools every step below may need
apt_install curl wget ca-certificates gnupg unzip tar xz-utils git build-essential

# ── Node.js ──────────────────────────────────────────────────────────────────
NODE_MIN_MAJOR=18
HAS_GOOD_NODE=false

if has node; then
  _nmaj=$(node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
  if [ "$_nmaj" -ge "$NODE_MIN_MAJOR" ] 2>/dev/null; then
    ok "Node.js $(node -v) detected."
    HAS_GOOD_NODE=true
  else
    warn "Node.js v${_nmaj} is too old (need v${NODE_MIN_MAJOR}+)."
  fi
fi

if ! $HAS_GOOD_NODE; then
  info "Installing Node.js 20 LTS..."

  if [ "$PM" = "apt" ]; then
    # NodeSource binary repo — supports both ARM64 and x86_64
    curl -fsSL https://deb.nodesource.com/setup_20.x | run_priv bash - 2>/dev/null || true
    run_priv apt-get install -y nodejs 2>/dev/null || true
  fi

  # Fallback: NVM (pure-userspace, any arch, no root needed)
  if ! has node; then
    warn "NodeSource failed — trying NVM..."
    export NVM_DIR="${HOME}/.nvm"
    if [ ! -d "$NVM_DIR" ]; then
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>/dev/null || true
    fi
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true
    if has nvm; then
      nvm install 20 2>/dev/null || true
      nvm use 20    2>/dev/null || true
      nvm alias default 20 2>/dev/null || true
    fi
  fi

  has node || die "Could not install Node.js. Install manually: https://nodejs.org"
  ok "Node.js $(node -v) ready."
fi

has npm || die "npm not found (should ship with Node.js)."
ok "npm $(npm -v) detected."

# ── Chromium ──────────────────────────────────────────────────────────────────
CHROMIUM_PATH=""
for _b in chromium-browser chromium google-chrome google-chrome-stable; do
  has "$_b" && CHROMIUM_PATH=$(command -v "$_b") && ok "Chromium: ${CHROMIUM_PATH}" && break
done

if [ -z "$CHROMIUM_PATH" ] && [ "$PM" = "apt" ]; then
  warn "Chromium not found — installing..."
  # ARM64 Ubuntu/Debian uses 'chromium'; x86 Ubuntu ships 'chromium-browser'
  if $IS_ARM; then
    run_priv apt-get install -y chromium 2>/dev/null || run_priv apt-get install -y chromium-browser 2>/dev/null || true
  else
    run_priv apt-get install -y chromium-browser 2>/dev/null || run_priv apt-get install -y chromium 2>/dev/null || true
  fi
  for _b in chromium-browser chromium google-chrome; do
    has "$_b" && CHROMIUM_PATH=$(command -v "$_b") && ok "Chromium installed: ${CHROMIUM_PATH}" && break
  done
  [ -z "$CHROMIUM_PATH" ] && warn "Chromium install failed — bot will run in simulated mode. Fix: apt install chromium"
fi

# ── esbuild (ARM64 page-alignment / Bus Error fix) ────────────────────────────
# npm's bundled esbuild is compiled for x86_64 (4 KB page alignment).
# ARM64 kernels require 16 KB alignment — the x86_64 binary triggers Bus Error.
# Solution: install a native system esbuild and point ESBUILD_BINARY_PATH to it.
ESBUILD_SYS=""
for _p in /usr/bin/esbuild /usr/local/bin/esbuild; do
  [ -x "$_p" ] && ESBUILD_SYS="$_p" && break
done

if $IS_ARM && [ -z "$ESBUILD_SYS" ]; then
  warn "ARM64: system esbuild missing — installing to prevent Bus Error in Vite..."
  run_priv apt-get install -y esbuild 2>/dev/null || true
  # apt esbuild may be too old on some distros; npm global is the reliable fallback
  if ! has esbuild; then
    npm install -g esbuild 2>/dev/null || true
  fi
  for _p in /usr/bin/esbuild /usr/local/bin/esbuild; do
    [ -x "$_p" ] && ESBUILD_SYS="$_p" && break
  done
  # npm global bin fallback
  if [ -z "$ESBUILD_SYS" ]; then
    _npm_g=$(npm root -g 2>/dev/null || true)
    _eg="${_npm_g}/esbuild/bin/esbuild"
    [ -x "$_eg" ] && ESBUILD_SYS="$_eg"
  fi
fi

if [ -n "$ESBUILD_SYS" ]; then
  export ESBUILD_BINARY_PATH="$ESBUILD_SYS"
  ok "ESBUILD_BINARY_PATH pinned: $ESBUILD_SYS"
elif $IS_ARM; then
  warn "No system esbuild found. Vite may crash with Bus Error. Fix: apt install esbuild"
fi

# Extra tools (non-fatal)
apt_install procps psmisc lsof fuser 2>/dev/null || true

# ═════════════════════════════════════════════════════════════════════════════
step "3/7" "Configuring environment (.env)"
# ═════════════════════════════════════════════════════════════════════════════

[ ! -f .env ] && { [ -f .env.example ] && cp .env.example .env || touch .env; ok "Created .env."; }

_env_get() { grep "^${1}=" .env 2>/dev/null | cut -d'=' -f2- | tr -d "\"'" | xargs 2>/dev/null || true; }
_env_set() {
  local _k="$1" _v="$2"
  grep -v "^${_k}=" .env > .env.tmp 2>/dev/null && mv .env.tmp .env || true
  printf '%s="%s"\n' "$_k" "$_v" >> .env
}

EX_EMAIL=$(_env_get VEKTAL_EMAIL)
EX_PASS=$(_env_get VEKTAL_PASSWORD)
EX_GEMINI=$(_env_get GEMINI_API_KEY)
EX_PORT=$(_env_get PORT)
EX_PORT="${EX_PORT:-3000}"

if [ -n "$EX_EMAIL" ] && [ -n "$EX_PASS" ]; then
  ok "Credentials found in .env — skipping prompts."
  info "Email : $EX_EMAIL  |  Port : $EX_PORT"
  NEW_EMAIL="$EX_EMAIL"; NEW_PASS="$EX_PASS"
  NEW_GEMINI="${EX_GEMINI:-}"; NEW_PORT="$EX_PORT"
else
  echo -e "\n${BY}  Enter your Vektal Nodes credentials (saved to .env only):${RST}"

  while true; do
    read -rp "$(echo -e "${BC}  ▸ Email${EX_EMAIL:+ [$EX_EMAIL]}: ${RST}")" NEW_EMAIL || true
    NEW_EMAIL="${NEW_EMAIL:-$EX_EMAIL}"
    [ -n "$NEW_EMAIL" ] && break; err "Email cannot be empty."
  done

  while true; do
    read -rsp "$(echo -e "${BC}  ▸ Password${EX_PASS:+ [keep existing]}: ${RST}")" NEW_PASS || true
    echo
    NEW_PASS="${NEW_PASS:-$EX_PASS}"
    [ -n "$NEW_PASS" ] && break; err "Password cannot be empty."
  done

  read -rp "$(echo -e "${BC}  ▸ Gemini API Key (optional): ${RST}")" NEW_GEMINI || true
  NEW_GEMINI="${NEW_GEMINI:-${EX_GEMINI:-}}"

  read -rp "$(echo -e "${BC}  ▸ Dashboard Port [$EX_PORT]: ${RST}")" NEW_PORT || true
  NEW_PORT="${NEW_PORT:-$EX_PORT}"

  _env_set VEKTAL_EMAIL    "$NEW_EMAIL"
  _env_set VEKTAL_PASSWORD "$NEW_PASS"
  _env_set PORT            "$NEW_PORT"
  [ -n "$NEW_GEMINI" ] && _env_set GEMINI_API_KEY "$NEW_GEMINI"
  ok "Credentials saved to .env."
fi

# ═════════════════════════════════════════════════════════════════════════════
step "4/7" "Configuring npm for PRoot / root environments"
# ═════════════════════════════════════════════════════════════════════════════

if [ "$(id -u)" -eq 0 ]; then
  npm config set user 0           2>/dev/null || true
  npm config set unsafe-perm true 2>/dev/null || true
  ok "npm root-container mode enabled (unsafe-perm=true)."
fi

[ -n "${ESBUILD_BINARY_PATH:-}" ] && npm config set ESBUILD_BINARY_PATH "$ESBUILD_BINARY_PATH" 2>/dev/null || true

# ═════════════════════════════════════════════════════════════════════════════
step "5/7" "Installing Node.js dependencies"
# ═════════════════════════════════════════════════════════════════════════════

export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
info "Running npm install (Chromium download skipped)..."

NPM_OK=false
for _flags in \
  "--unsafe-perm=true --legacy-peer-deps" \
  "--unsafe-perm=true --legacy-peer-deps --no-audit --no-fund" \
  "--legacy-peer-deps"; do
  if PUPPETEER_SKIP_DOWNLOAD=true npm install $_flags 2>&1; then
    NPM_OK=true; break
  fi
  warn "Install attempt failed — retrying with different flags..."
done

if ! $NPM_OK; then
  die "npm install failed after all retries. Check errors above."
fi
ok "All dependencies installed."

# ═════════════════════════════════════════════════════════════════════════════
step "6/7" "Applying proot-specific runtime patches"
# ═════════════════════════════════════════════════════════════════════════════

# Re-check esbuild after install (npm may have placed one in node_modules/.bin)
if [ -z "${ESBUILD_BINARY_PATH:-}" ]; then
  for _p in /usr/bin/esbuild /usr/local/bin/esbuild; do
    [ -x "$_p" ] && export ESBUILD_BINARY_PATH="$_p" && ok "ESBUILD_BINARY_PATH set post-install: $_p" && break
  done
else
  ok "ESBUILD_BINARY_PATH: $ESBUILD_BINARY_PATH"
fi

# Puppeteer executable path
if [ -n "${CHROMIUM_PATH:-}" ]; then
  export PUPPETEER_EXECUTABLE_PATH="$CHROMIUM_PATH"
  ok "PUPPETEER_EXECUTABLE_PATH: $CHROMIUM_PATH"
else
  warn "No Chromium — bot will run in simulated mode."
fi

# Kill any process already holding the port (uses fuser, fallback to ss+kill)
_kill_port() {
  local port="$1"
  if has fuser; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  elif has lsof; then
    kill "$(lsof -ti:"$port" 2>/dev/null)" 2>/dev/null || true
  elif has ss; then
    local pid
    pid=$(ss -ltnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  fi
}

PORT_BUSY=false
if has ss; then
  ss -ltn 2>/dev/null | grep -q ":${NEW_PORT}[[:space:]]" && PORT_BUSY=true || true
fi
if $PORT_BUSY; then
  warn "Port ${NEW_PORT} is already in use — killing existing process..."
  _kill_port "$NEW_PORT"
  sleep 1
  ok "Port ${NEW_PORT} freed."
fi

# ═════════════════════════════════════════════════════════════════════════════
step "7/7" "Choose launch profile"
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "  ${BG}1)${RST} ${W}DEVELOPMENT MODE${RST}   — Live tsx reload + Vite HMR (fastest iteration)"
echo -e "  ${BG}2)${RST} ${W}PRODUCTION MODE${RST}    — vite build then optimised node server"
echo -e "  ${BG}3)${RST} ${W}BUILD ONLY${RST}         — Compile ./dist and exit"
echo -e "  ${BG}4)${RST} ${W}EXIT${RST}               — Done with setup, exit without launching"
echo ""
read -rp "$(echo -e "${BC}  ▸ Select profile (1-4) [default: 1]: ${RST}")" CHOICE || CHOICE=""
CHOICE="${CHOICE:-1}"

# Build the env prefix string for launch commands
_build_env() {
  local env_str="PORT=${NEW_PORT} NODE_ENV=${1:-development}"
  env_str="${env_str} PUPPETEER_SKIP_DOWNLOAD=true"
  env_str="${env_str} PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true"
  [ -n "${PUPPETEER_EXECUTABLE_PATH:-}" ] && env_str="${env_str} PUPPETEER_EXECUTABLE_PATH=${PUPPETEER_EXECUTABLE_PATH}"
  [ -n "${ESBUILD_BINARY_PATH:-}" ]       && env_str="${env_str} ESBUILD_BINARY_PATH=${ESBUILD_BINARY_PATH}"
  echo "$env_str"
}

launch_dev() {
  echo -e "\n${BY}  Launching DEVELOPMENT server on port ${NEW_PORT}...${RST}"
  echo -e "  ${C}Open: http://localhost:${NEW_PORT}${RST}\n"
  eval "$(_build_env development) npm run dev"
}

launch_build() {
  echo -e "\n${BY}  Compiling production bundle...${RST}"
  eval "$(_build_env production) npm run build"
}

launch_prod() {
  echo -e "\n${BY}  Starting PRODUCTION server on port ${NEW_PORT}...${RST}"
  echo -e "  ${C}Open: http://localhost:${NEW_PORT}${RST}\n"
  eval "$(_build_env production) npm start"
}

case $CHOICE in
  1)
    launch_dev
    ;;
  2)
    if launch_build; then
      ok "Build succeeded."
      launch_prod
    else
      err "Build failed — common proot/ARM64 fixes:"
      echo -e "  ${C}apt install esbuild${RST}          ← ARM64 Bus Error"
      echo -e "  ${C}apt install chromium${RST}         ← Puppeteer target"
      echo -e "  ${C}Move project out of /sdcard${RST}  ← symlink / exec support"
      exit 1
    fi
    ;;
  3)
    if launch_build; then
      ok "Build complete — output in ./dist"
      echo -e "  Start manually: ${C}PORT=${NEW_PORT} npm start${RST}"
    else
      err "Build failed — see above."; exit 1
    fi
    ;;
  *)
    echo ""
    ok "Setup complete. Start manually:"
    echo -e "  ${C}Dev  : PORT=${NEW_PORT} npm run dev${RST}"
    echo -e "  ${C}Prod : npm run build && PORT=${NEW_PORT} npm start${RST}"
    echo ""
    ;;
esac
