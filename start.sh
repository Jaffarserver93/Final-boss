#!/bin/bash

# Elegant ANSI Style Colors
CYAN='\033[0;36m'
BOLD_CYAN='\033[1;36m'
GREEN='\033[0;32m'
BOLD_GREEN='\033[1;32m'
YELLOW='\033[0;33m'
BOLD_YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD_RED='\033[1;31m'
MAGENTA='\033[0;35m'
BOLD_MAGENTA='\033[1;35m'
RESET='\033[0m'

# Clear terminal screen
clear

# Display Beautiful ASCII Banner
echo -e "${BOLD_CYAN}===============================================================${RESET}"
echo -e "${BOLD_CYAN}        ___   _______ _  __   ___   ___ _____                    ${RESET}"
echo -e "${BOLD_CYAN}       / _ | / __/ _ / |/ /  / _ ) / _ /_  __/                    ${RESET}"
echo -e "${BOLD_CYAN}      / __ |/ _// , _/    /  / _  |/ _  |/ /                       ${RESET}"
echo -e "${BOLD_CYAN}     /_/ |_/_/ /_/|_/_/|_/  /____//___//_/                         ${RESET}"
echo -e "${BOLD_CYAN}                                                                   ${RESET}"
echo -e "${BOLD_MAGENTA}      [ AFK Dashboard Engine v1.2 - Local Launch Sequence ]        ${RESET}"
echo -e "${BOLD_CYAN}===============================================================${RESET}"
echo ""

# Helper verification functions
check_dependency() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "${BOLD_RED}❌ Error: '$1' is not installed or not in your system's PATH.${RESET}"
    echo -e "${YELLOW}👉 Please install $2 before running this script.${RESET}"
    exit 1
  fi
}

echo -e "${BOLD_CYAN}[1/4] Verifying local package runtime environments...${RESET}"
check_dependency "node" "Node.js (v18+ recommended)"
check_dependency "npm" "Node Package Manager (npm)"
echo -e "${GREEN}✔ Node.js version $(node -v) detected!${RESET}"
echo -e "${GREEN}✔ NPM version $(npm -v) detected!${RESET}"
echo ""

# Setup environment configuration (.env)
echo -e "${BOLD_CYAN}[2/4] Initializing secure environment parameters (.env)...${RESET}"

# Read existing credentials if they are already present
EXISTING_EMAIL=""
EXISTING_PASS=""
if [ -f .env ]; then
  EXISTING_EMAIL=$(grep "^VEKTAL_EMAIL=" .env | cut -d'=' -f2- | tr -d '"'\' | xargs 2>/dev/null || grep "^VEKTAL_EMAIL=" .env | cut -d'=' -f2- | tr -d '"'\')
  EXISTING_PASS=$(grep "^VEKTAL_PASSWORD=" .env | cut -d'=' -f2- | tr -d '"'\' | xargs 2>/dev/null || grep "^VEKTAL_PASSWORD=" .env | cut -d'=' -f2- | tr -d '"'\')
fi

SKIP_PROMPTS="false"
if [ -n "$EXISTING_EMAIL" ] && [ -n "$EXISTING_PASS" ]; then
  SKIP_PROMPTS="true"
  NEW_EMAIL="$EXISTING_EMAIL"
  NEW_PASS="$EXISTING_PASS"
  NEW_GEMINI=$(grep "^GEMINI_API_KEY=" .env | cut -d'=' -f2- | tr -d '"'\' | xargs 2>/dev/null || grep "^GEMINI_API_KEY=" .env | cut -d'=' -f2- | tr -d '"'\')
  echo ""
  echo -e "${GREEN}✔ Existing Vektal Nodes credentials found in .env! Skipping prompts and reusing configuration.${RESET}"
  echo -e "   - Email: ${CYAN}$NEW_EMAIL${RESET}"
  echo ""
fi

if [ "$SKIP_PROMPTS" = "false" ]; then
  # Double-check .env existence and allow clear resetting
  if [ -f .env ]; then
    echo -e "${YELLOW}⚠️  Existing '.env' file detected.${RESET}"
    read -p "Do you want to reset and overwrite your existing .env settings? (y/N): " OVERWRITE_ENV
    if [[ "$OVERWRITE_ENV" =~ ^[Yy]$ ]]; then
      rm -f .env
    fi
  fi

  if [ ! -f .env ]; then
    if [ -f .env.example ]; then
      cp .env.example .env
      echo -e "${GREEN}✔ Successfully bootstrapped .env from template.${RESET}"
    else
      touch .env
      echo -e "${GREEN}✔ Created clean .env configuration file.${RESET}"
    fi
  fi

  # Request User Inputs with gorgeous prompt formatting
  echo ""
  echo -e "${BOLD_YELLOW}💬 Please provide your Vektal Nodes credentials below.${RESET}"
  echo -e "${YELLOW}These values will be stored locally inside '.env' and never exposed to public repositories.${RESET}"
  echo ""

  # 1. VEKTAL_EMAIL Input
  CURRENT_EMAIL=$(grep "^VEKTAL_EMAIL=" .env | cut -d'=' -f2- | tr -d '"'\' | xargs 2>/dev/null || grep "^VEKTAL_EMAIL=" .env | cut -d'=' -f2- | tr -d '"'\')
  if [ -n "$CURRENT_EMAIL" ]; then
    read -p "$(echo -e "${BOLD_CYAN}▸ Enter Vektal Nodes Email [Current: $CURRENT_EMAIL]: ${RESET}")" NEW_EMAIL
    if [ -z "$NEW_EMAIL" ]; then
      NEW_EMAIL=$CURRENT_EMAIL
    fi
  else
    while [ -z "$NEW_EMAIL" ]; do
      read -p "$(echo -e "${BOLD_CYAN}▸ Enter Vektal Nodes Email: ${RESET}")" NEW_EMAIL
      if [ -z "$NEW_EMAIL" ]; then
        echo -e "${RED}⚠️  Email cannot be empty during initial configuration.${RESET}"
      fi
    done
  fi

  # 2. VEKTAL_PASSWORD Input (Securely hidden)
  CURRENT_PASS=$(grep "^VEKTAL_PASSWORD=" .env | cut -d'=' -f2- | tr -d '"'\' | xargs 2>/dev/null || grep "^VEKTAL_PASSWORD=" .env | cut -d'=' -f2- | tr -d '"'\')
  if [ -n "$CURRENT_PASS" ]; then
    echo -e "${BOLD_CYAN}▸ Enter Vektal Nodes Password [Current: ********] (Keystrokes hidden): ${RESET}"
    read -s NEW_PASS
    if [ -z "$NEW_PASS" ]; then
      NEW_PASS=$CURRENT_PASS
    fi
  else
    while [ -z "$NEW_PASS" ]; do
      echo -e "${BOLD_CYAN}▸ Enter Vektal Nodes Password (Keystrokes hidden): ${RESET}"
      read -s NEW_PASS
      if [ -z "$NEW_PASS" ]; then
        echo -e "${RED}⚠️  Password cannot be empty during initial configuration.${RESET}"
      fi
    done
  fi

  # 3. Optional GEMINI_API_KEY
  CURRENT_GEMINI=$(grep "^GEMINI_API_KEY=" .env | cut -d'=' -f2- | tr -d '"'\' | xargs 2>/dev/null || grep "^GEMINI_API_KEY=" .env | cut -d'=' -f2- | tr -d '"'\')
  if [ -n "$CURRENT_GEMINI" ]; then
    read -p "$(echo -e "${BOLD_CYAN}▸ Enter Gemini API Key (Optional) [Current exists]: ${RESET}")" NEW_GEMINI
    if [ -z "$NEW_GEMINI" ]; then
      NEW_GEMINI=$CURRENT_GEMINI
    fi
  else
    read -p "$(echo -e "${BOLD_CYAN}▸ Enter Gemini API Key (Optional for smart metrics): ${RESET}")" NEW_GEMINI
  fi

  # Write updated parameters to .env securely
  sed -i.bak -e '/^VEKTAL_EMAIL=/d' .env 2>/dev/null || true
  sed -i.bak -e '/^VEKTAL_PASSWORD=/d' .env 2>/dev/null || true
  sed -i.bak -e '/^GEMINI_API_KEY=/d' .env 2>/dev/null || true
  rm -f .env.bak 2>/dev/null || true

  echo "VEKTAL_EMAIL=\"$NEW_EMAIL\"" >> .env
  echo "VEKTAL_PASSWORD=\"$NEW_PASS\"" >> .env
  if [ -n "$NEW_GEMINI" ]; then
    echo "GEMINI_API_KEY=\"$NEW_GEMINI\"" >> .env
  fi

  echo ""
  echo -e "${GREEN}✔ Credentials updated and stored in .env successfully!${RESET}"
  echo ""
fi

# Installing Dependencies
echo -e "${BOLD_CYAN}[3/4] Installing necessary workspace node dependencies...${RESET}"
echo -e "${YELLOW}Please wait while npm retrieves latest compatible libraries (this may take a moment)...${RESET}"
echo ""

# Ensure we have correct directory ownership for the current executing user
# This avoids npm security checks that automatically downgrade privileges in root folders and cause EACCES errors.
chown -R "$(whoami)" . 2>/dev/null || true
chmod -R 755 . 2>/dev/null || true

# If executing as root (UID 0), configure npm to run cleanly without security downgrades
if [ "$(id -u)" -eq 0 ]; then
  npm config set user 0 2>/dev/null || true
  npm config set unsafe-perm true 2>/dev/null || true
fi

# Robust container execution installation with root bypass (prevents EACCES error)
npm install --unsafe-perm=true --legacy-peer-deps || npm install --no-audit --no-fund --unsafe-perm=true --legacy-peer-deps || npm install --legacy-peer-deps

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✔ NPM Package dependencies resolved completely!${RESET}"
else
  echo ""
  echo -e "${BOLD_RED}❌ Error: Dependencies installation failed. Please check log traces above.${RESET}"
  exit 1
fi

echo ""
# Boot choice Menu
echo -e "${BOLD_CYAN}[4/4] Setup completed successfully! Select your boot workspace profile:${RESET}"
echo -e "  ${BOLD_GREEN}1)${RESET} Launch in ${BOLD_GREEN}DEVELOPMENT MODE${RESET} (Realtime direct tsx backend loader)"
echo -e "  ${BOLD_GREEN}2)${RESET} Launch in ${BOLD_GREEN}PRODUCTION BUILD MODE${RESET} (Clean bundled bundle compilation & start)"
echo -e "  ${BOLD_GREEN}3)${RESET} Just complete configuration and exit configuration framework"
echo ""

read -p "$(echo -e "${BOLD_CYAN}▸ Select boot profile (1-3): ${RESET}")" CHOICE

case $CHOICE in
  1)
    echo ""
    echo -e "${BOLD_YELLOW}🚀 Ignition activated! Launching Development Environment...${RESET}"
    echo -e "${YELLOW}Open http://localhost:3000 inside your web browser to check AFK Telemetry Dashboard Panel.${RESET}"
    echo ""
    npm run dev
    ;;
  2)
    echo ""
    echo -e "${BOLD_YELLOW}⚙️  Compiling bundle and optimizing node production artifacts...${RESET}"
    npm run build
    if [ $? -eq 0 ]; then
      echo ""
      echo -e "${BOLD_YELLOW}🚀 Launching Standalone production bundle on secure local socket port 3000...${RESET}"
      echo -e "${YELLOW}Open http://localhost:3000 inside your web browser to check AFK Telemetry Dashboard Panel.${RESET}"
      echo ""
      npm start
    else
      echo -e "${BOLD_RED}❌ Build compilation failed. Reverting launcher session.${RESET}"
    fi
    ;;
  *)
    echo ""
    echo -e "${BOLD_GREEN}✨ Configuration completed! You can manually start your engine anytime using:${RESET}"
    echo -e "   - Development: ${CYAN}npm run dev${RESET}"
    echo -e "   - Production:  ${CYAN}npm run build && npm start${RESET}"
    echo ""
    ;;
esac
