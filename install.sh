#!/usr/bin/env bash
# install.sh — depctl installer
# Usage: curl -sSL https://raw.githubusercontent.com/ipepio/docker-deploy-webhook/main/install.sh | bash

set -euo pipefail

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────
DEPCTL_VERSION="${DEPCTL_VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/depctl}"
STACKS_DIR="${STACKS_DIR:-/opt/stacks}"
GITHUB_RAW="https://raw.githubusercontent.com/ipepio/docker-deploy-webhook/main"
REPO_URL="https://github.com/ipepio/docker-deploy-webhook"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

_info()    { echo -e "${GREEN}[depctl]${NC} $*"; }
_warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
_error()   { echo -e "${RED}[error]${NC} $*" >&2; }
_section() { echo -e "\n${BOLD}──── $* ────${NC}"; }

# ─────────────────────────────────────────────
# Task 1.1 — Check prerequisites
# ─────────────────────────────────────────────
check_prerequisites() {
  _section "Checking prerequisites"

  # Must run as root
  if [[ $EUID -ne 0 ]]; then
    _error "This script must be run as root (or with sudo)."
    _error "Try: sudo bash install.sh"
    exit 1
  fi

  # Detect distro
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    source /etc/os-release
    _info "Detected OS: ${PRETTY_NAME:-unknown}"
  else
    _warn "Could not detect OS (/etc/os-release not found). Proceeding anyway."
  fi

  local missing=()

  # Check docker daemon
  if ! command -v docker &>/dev/null; then
    missing+=("docker")
  elif ! docker info &>/dev/null 2>&1; then
    _error "Docker is installed but the daemon is not running."
    _error "Start it with: sudo systemctl start docker"
    exit 1
  fi

  # Check docker compose v2 plugin
  if ! docker compose version &>/dev/null 2>&1; then
    missing+=("docker-compose-plugin")
  fi

  # Check curl
  if ! command -v curl &>/dev/null; then
    missing+=("curl")
  fi

  # Check jq
  if ! command -v jq &>/dev/null; then
    missing+=("jq")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    _error "Missing prerequisites: ${missing[*]}"
    echo ""
    echo "Install them with:"
    echo "  apt-get install -y ${missing[*]}"
    echo ""
    echo "For Docker, see: https://docs.docker.com/engine/install/"
    exit 1
  fi

  _info "All prerequisites satisfied ✓"
}

# ─────────────────────────────────────────────
# Task 1.2 — Create directory structure
# ─────────────────────────────────────────────
create_directories() {
  _section "Creating directory structure"

  local dirs=(
    "${INSTALL_DIR}"
    "${INSTALL_DIR}/config"
    "${INSTALL_DIR}/config/repos"
    "${INSTALL_DIR}/data"
    "${STACKS_DIR}"
  )

  for dir in "${dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      mkdir -p "$dir"
      chmod 755 "$dir"
      _info "Created: $dir"
    else
      _info "Already exists: $dir"
    fi
  done
}

# ─────────────────────────────────────────────
# Task 1.3 — Download project artifacts
# ─────────────────────────────────────────────
download_artifacts() {
  _section "Downloading project files"

  local files=(
    "docker-compose.yml"
    "Dockerfile"
    ".env.example"
    "config/server.example.yml"
  )

  for file in "${files[@]}"; do
    local dest="${INSTALL_DIR}/${file}"
    local dest_dir
    dest_dir="$(dirname "$dest")"

    mkdir -p "$dest_dir"

    _info "Downloading: $file"
    if ! curl -sSfL "${GITHUB_RAW}/${file}" -o "${dest}.tmp"; then
      _error "Failed to download: ${GITHUB_RAW}/${file}"
      rm -f "${dest}.tmp"
      exit 1
    fi
    mv "${dest}.tmp" "$dest"
  done

  # Copy .env.example → .env only if .env doesn't exist
  if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
    cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
    _info "Created .env from .env.example"
  else
    _info "Keeping existing .env (not overwritten)"
  fi

  # Copy server.example.yml → server.yml only if server.yml doesn't exist
  if [[ ! -f "${INSTALL_DIR}/config/server.yml" ]]; then
    cp "${INSTALL_DIR}/config/server.example.yml" "${INSTALL_DIR}/config/server.yml"
    _info "Created config/server.yml from example"
  else
    _info "Keeping existing config/server.yml (not overwritten)"
  fi
}

# ─────────────────────────────────────────────
# Task 1.4 — Generate admin tokens
# ─────────────────────────────────────────────
_tokens_generated=false
_admin_read_token=""
_admin_write_token=""

generate_admin_tokens() {
  _section "Generating admin tokens"

  local env_file="${INSTALL_DIR}/.env"

  # Read existing values
  local existing_read existing_write
  existing_read="$(grep -E '^DEPLOY_ADMIN_READ_TOKEN=' "$env_file" | cut -d= -f2- | tr -d '"' || true)"
  existing_write="$(grep -E '^DEPLOY_ADMIN_WRITE_TOKEN=' "$env_file" | cut -d= -f2- | tr -d '"' || true)"

  if [[ -n "$existing_read" && -n "$existing_write" ]]; then
    _info "Admin tokens already exist (not regenerated)"
    return
  fi

  # Generate new tokens (48 hex chars = 24 bytes)
  _admin_read_token="$(openssl rand -hex 24)"
  _admin_write_token="$(openssl rand -hex 24)"
  _tokens_generated=true

  # Write to .env (replace or append)
  if grep -q '^DEPLOY_ADMIN_READ_TOKEN=' "$env_file"; then
    sed -i "s|^DEPLOY_ADMIN_READ_TOKEN=.*|DEPLOY_ADMIN_READ_TOKEN=${_admin_read_token}|" "$env_file"
  else
    echo "DEPLOY_ADMIN_READ_TOKEN=${_admin_read_token}" >> "$env_file"
  fi

  if grep -q '^DEPLOY_ADMIN_WRITE_TOKEN=' "$env_file"; then
    sed -i "s|^DEPLOY_ADMIN_WRITE_TOKEN=.*|DEPLOY_ADMIN_WRITE_TOKEN=${_admin_write_token}|" "$env_file"
  else
    echo "DEPLOY_ADMIN_WRITE_TOKEN=${_admin_write_token}" >> "$env_file"
  fi

  _info "Admin tokens generated ✓"
}

# ─────────────────────────────────────────────
# Task 1.5 — Start services
# ─────────────────────────────────────────────
start_services() {
  _section "Starting services"

  cd "${INSTALL_DIR}"

  # Build + start webhook and redis
  docker compose up -d --build webhook redis

  # Wait for redis healthcheck (up to 30s)
  _info "Waiting for Redis to be healthy..."
  local retries=30
  while [[ $retries -gt 0 ]]; do
    local status
    status="$(docker inspect --format='{{.State.Health.Status}}' docker-deploy-webhook-redis 2>/dev/null || echo 'missing')"
    if [[ "$status" == "healthy" ]]; then
      _info "Redis is healthy ✓"
      break
    fi
    sleep 1
    (( retries-- ))
  done

  if [[ $retries -eq 0 ]]; then
    _error "Redis did not become healthy in time."
    docker compose logs --tail 20 redis
    exit 1
  fi

  # Wait for webhook /health (up to 30s)
  _info "Waiting for webhook to respond at /health..."
  local port
  port="$(grep -E '^PORT=' "${INSTALL_DIR}/.env" | cut -d= -f2 | tr -d '"' || echo 8080)"
  port="${port:-8080}"
  retries=30

  while [[ $retries -gt 0 ]]; do
    if curl -sf "http://localhost:${port}/health" &>/dev/null; then
      _info "Webhook is healthy ✓"
      break
    fi
    sleep 1
    (( retries-- ))
  done

  if [[ $retries -eq 0 ]]; then
    _error "Webhook did not respond at http://localhost:${port}/health in time."
    docker compose logs --tail 20 webhook
    exit 1
  fi
}

# ─────────────────────────────────────────────
# Task 1.6 — Print post-install summary
# ─────────────────────────────────────────────
print_summary() {
  local port
  port="$(grep -E '^PORT=' "${INSTALL_DIR}/.env" | cut -d= -f2 | tr -d '"' || echo 8080)"
  port="${port:-8080}"

  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}${BOLD}  depctl installed successfully ✅${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  Health:  http://localhost:${port}/health"
  echo "  Config:  ${INSTALL_DIR}/config/"
  echo "  Stacks:  ${STACKS_DIR}/"
  echo ""

  if [[ "$_tokens_generated" == true ]]; then
    echo -e "${YELLOW}${BOLD}  ⚠ Save these tokens — they won't be shown again:${NC}"
    echo ""
    echo "  Admin read token:   ${_admin_read_token}"
    echo "  Admin write token:  ${_admin_write_token}"
    echo ""
  fi

  echo "  Next step:"
  echo "    depctl repo add"
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

# ─────────────────────────────────────────────
# Task F07 — Install depctl wrapper on host PATH
# ─────────────────────────────────────────────
install_depctl_wrapper() {
  _section "Installing depctl on PATH"

  local wrapper_path="/usr/local/bin/depctl"

  cat > "$wrapper_path" <<WRAPPER
#!/usr/bin/env bash
# depctl — wrapper installed by install.sh
# Routes to the admin container in the correct project directory
exec docker compose --project-directory "${INSTALL_DIR}" --profile admin run --rm admin "\$@"
WRAPPER

  chmod +x "$wrapper_path"
  _info "Installed: ${wrapper_path}"
  _info "Run 'depctl help' to get started"
}

# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}depctl installer${NC}"
  echo -e "Source: ${REPO_URL}"
  echo ""

  check_prerequisites
  create_directories
  download_artifacts
  generate_admin_tokens
  start_services
  install_depctl_wrapper
  print_summary
}

main "$@"
