#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

required_env_keys=(
  PBI_BASE_URL
  PBI_CAPACITY_ID
  PBI_WORKLOAD
  PBI_SERVICE
  PBI_VISIBILITY
  PBI_TOKEN
  PBI_OUTPUT_FILE
  PBI_TEMPLATE_FILE
  PBI_EMPREENDIMENTO_OUTPUT_DIR
  PBI_START_INDEX
  PBI_FORMATTED_OUTPUT_DIR
  PBI_VALIDATE_SAMPLE_SIZE
)

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

package_has_dependency() {
  local dependency="$1"

  node - "$dependency" <<'NODE'
const fs = require("node:fs");

const dependency = process.argv[2];
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const dependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
  ...packageJson.optionalDependencies,
};

process.exit(Object.prototype.hasOwnProperty.call(dependencies, dependency) ? 0 : 1);
NODE
}

get_env_value() {
  local file="$1"
  local key="$2"

  if [[ ! -f "$file" ]]; then
    return 1
  fi

  awk -F= -v key="$key" '
    $0 ~ "^[[:space:]]*#" { next }
    $1 == key {
      sub(/^[^=]*=/, "")
      print
      exit
    }
  ' "$file"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp_file

  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ "^[[:space:]]*#" {
      print
      next
    }
    index($0, key "=") == 1 {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" > "$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

ensure_env_key_from_example() {
  local key="$1"
  local current
  local default_value

  current="$(get_env_value "$ENV_FILE" "$key" || true)"
  if [[ -n "$current" ]]; then
    return 0
  fi

  default_value="$(get_env_value "$ENV_EXAMPLE" "$key" || true)"
  if [[ -n "$default_value" ]]; then
    set_env_value "$key" "$default_value"
  fi
}

ensure_token() {
  local current_token
  current_token="$(get_env_value "$ENV_FILE" PBI_TOKEN || true)"

  if [[ -n "${PBI_TOKEN:-}" ]]; then
    set_env_value PBI_TOKEN "$PBI_TOKEN"
    log "PBI_TOKEN populated from the current shell environment."
    return 0
  fi

  if [[ -n "$current_token" && "$current_token" != "replace_with_mwc_token" ]]; then
    log "PBI_TOKEN already exists in $ENV_FILE."
    return 0
  fi

  if [[ "${SETUP_SKIP_TOKEN_PROMPT:-}" == "1" ]]; then
    log "PBI_TOKEN was not changed because SETUP_SKIP_TOKEN_PROMPT=1."
    return 0
  fi

  if [[ ! -t 0 ]]; then
    fail "PBI_TOKEN is missing. Re-run interactively or pass it as: PBI_TOKEN=... bash scripts/setup.sh"
  fi

  local token
  read -r -s -p "Enter PBI_TOKEN without the MWCToken prefix: " token
  printf '\n'

  if [[ -z "$token" ]]; then
    fail "PBI_TOKEN cannot be empty"
  fi

  if [[ "$token" == MWCToken* ]]; then
    fail "PBI_TOKEN must not include the MWCToken prefix"
  fi

  set_env_value PBI_TOKEN "$token"
  log "PBI_TOKEN saved in $ENV_FILE."
}

validate_json_file() {
  local file="$1"
  local description="$2"

  [[ -f "$file" ]] || fail "Missing $description: $file"
  node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" "$file" \
    || fail "Invalid JSON in $description: $file"
}

validate_input_shapes() {
  local empre_file
  local template_file

  empre_file="$(get_env_value "$ENV_FILE" PBI_OUTPUT_FILE || true)"
  template_file="$(get_env_value "$ENV_FILE" PBI_TEMPLATE_FILE || true)"

  validate_json_file "$empre_file" "empreendimento input file"
  validate_json_file "$template_file" "template input file"

  node - "$empre_file" "$template_file" <<'NODE'
const fs = require("node:fs");

const empreFile = process.argv[2];
const templateFile = process.argv[3];
const empreData = JSON.parse(fs.readFileSync(empreFile, "utf8"));
const templateData = JSON.parse(fs.readFileSync(templateFile, "utf8"));

const hasEmpreendimentos = Array.isArray(empreData.empreendimentos);
const hasItems = Array.isArray(empreData.items);
if (!hasEmpreendimentos && !hasItems) {
  throw new Error(`${empreFile} must contain either an empreendimentos array or an items array`);
}

if (!Array.isArray(templateData.templates) || templateData.templates.length === 0) {
  throw new Error(`${templateFile} must contain a non-empty templates array`);
}
NODE
}

validate_scripts() {
  node --check scripts/dump-dashboard-data.js >/dev/null
  node --check scripts/format-dashboard-data.js >/dev/null
}

setup_playwright_if_needed() {
  if ! package_has_dependency playwright; then
    log "Playwright is not listed in package.json; skipping browser setup."
    return 0
  fi

  if [[ "${SETUP_SKIP_PLAYWRIGHT:-}" == "1" ]]; then
    log "Playwright is listed in package.json, but browser setup was skipped because SETUP_SKIP_PLAYWRIGHT=1."
    return 0
  fi

  log "Playwright is listed in package.json; installing Chromium browser files..."
  npx playwright install chromium
}

main() {
  log "Setting up Portal Relatorios..."

  command_exists node || fail "node is not installed"
  command_exists npm || fail "npm is not installed"
  [[ -f "$ENV_EXAMPLE" ]] || fail "Missing $ENV_EXAMPLE"

  log "Installing npm dependencies..."
  npm install

  setup_playwright_if_needed

  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    log "Created $ENV_FILE from $ENV_EXAMPLE."
  else
    log "$ENV_FILE already exists; preserving existing values."
  fi

  for key in "${required_env_keys[@]}"; do
    ensure_env_key_from_example "$key"
  done

  ensure_token

  log "Validating input files and scripts..."
  validate_input_shapes
  validate_scripts

  log "Setup completed."
  log ""
  log "Next commands:"
  log "  npm run dump:empreendimento-data"
  log "  npm run format:empreendimento-data"
  log "  npm run full:empreendimento-data"
}

main "$@"
