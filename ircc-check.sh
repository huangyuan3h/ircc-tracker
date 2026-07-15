#!/usr/bin/env bash
# IRCC Tracker status checker.
# Authenticates via AWS Cognito, fetches application details, and appends a status report.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

# Defaults (overridable via environment for tests / local overrides)
: "${COGNITO_URL:=https://cognito-idp.ca-central-1.amazonaws.com/}"
: "${COGNITO_CLIENT_ID:=3cfutv5ffd1i622g1tn6vton5r}"
: "${IRCC_API_URL:=https://api.ircc-tracker-suivi.apps.cic.gc.ca/user}"
: "${ENV_FILE:=${SCRIPT_DIR}/.env}"
: "${CURL_BIN:=curl}"
: "${JQ_BIN:=jq}"
: "${REQUEST_TIMEOUT_SECONDS:=30}"
: "${HTML_REPORT_PATH:=${SCRIPT_DIR}/StatusReport.html}"
: "${RENDER_JQ:=${SCRIPT_DIR}/lib/render-report.jq}"
IRCC_REFERENCE_JSON="${IRCC_REFERENCE_JSON:-${SCRIPT_DIR}/lib/ircc-events.json}"
export IRCC_REFERENCE_JSON

# Config values loaded from .env (declared for ShellCheck and defaults)
TRACKER_USERNAME="${TRACKER_USERNAME:-}"
TRACKER_PASSWORD="${TRACKER_PASSWORD:-}"
APP_NUMBER="${APP_NUMBER:-}"
UCI_NUMBER="${UCI_NUMBER:-}"
LOG_PATH="${LOG_PATH:-}"

readonly EXIT_OK=0
readonly EXIT_USAGE=2
readonly EXIT_CONFIG=3
readonly EXIT_DEPENDENCY=4
readonly EXIT_AUTH=5
readonly EXIT_QUERY=6
readonly EXIT_PARSE=7

CYAN=$'\033[0;36m'
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
NC=$'\033[0m'

NOT_AVAILABLE="Not available"
NOT_STARTED="Not started"

die() {
  local code="$1"
  shift
  printf '%s%s%s\n' "${RED}" "$*" "${NC}" >&2
  exit "${code}"
}

info() {
  printf '%s%s%s\n' "${CYAN}" "$*" "${NC}"
}

success() {
  printf '%s%s%s\n' "${GREEN}" "$*" "${NC}"
}

warn() {
  printf '%s%s%s\n' "${YELLOW}" "$*" "${NC}" >&2
}

require_commands() {
  local missing=()
  local cmd
  for cmd in "$@"; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
      missing+=("${cmd}")
    fi
  done

  if ((${#missing[@]} > 0)); then
    die "${EXIT_DEPENDENCY}" "Missing required command(s): ${missing[*]}. Install via Homebrew (see Brewfile)."
  fi
}

# Load KEY=VALUE pairs from .env without executing shell code.
load_env_file() {
  local env_path="${1}"
  local line key value

  if [[ ! -f "${env_path}" ]]; then
    die "${EXIT_CONFIG}" "Config file not found: ${env_path}. Copy .env.example to .env and fill in your details."
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    local mode
    mode="$(stat -f '%Lp' "${env_path}" 2>/dev/null || true)"
    if [[ -n "${mode}" && "${mode}" != "600" && "${mode}" != "400" ]]; then
      warn "Warning: ${env_path} permissions are ${mode}; prefer chmod 600 ${env_path}"
    fi
  fi

  while IFS= read -r line || [[ -n "${line}" ]]; do
    # Trim leading/trailing whitespace
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    [[ -z "${line}" || "${line}" == \#* ]] && continue

    if [[ "${line}" != *=* ]]; then
      die "${EXIT_CONFIG}" "Invalid .env line (expected KEY=VALUE): ${line}"
    fi

    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"

    # Strip matching surrounding quotes
    if [[ "${value}" =~ ^\".*\"$ ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value}" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi

    case "${key}" in
      TRACKER_USERNAME | TRACKER_PASSWORD | APP_NUMBER | UCI_NUMBER | LOG_PATH)
        printf -v "${key}" '%s' "${value}"
        # Export by variable name loaded from .env
        export "${key?}"
        ;;
      *)
        # Ignore unknown keys to keep config flexible
        ;;
    esac
  done <"${env_path}"
}

validate_config() {
  local require_app="${1:-1}"
  local required=(TRACKER_USERNAME TRACKER_PASSWORD UCI_NUMBER)
  local name
  local missing=()

  if [[ "${require_app}" == "1" ]]; then
    required+=(APP_NUMBER)
  fi

  for name in "${required[@]}"; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("${name}")
    fi
  done

  if ((${#missing[@]} > 0)); then
    if [[ " ${missing[*]} " == *" APP_NUMBER "* ]]; then
      die "${EXIT_CONFIG}" "Missing required config value(s): ${missing[*]}. Run ./ircc-check.sh --list to discover APP_NUMBER."
    fi
    die "${EXIT_CONFIG}" "Missing required config value(s): ${missing[*]}"
  fi

  if [[ -n "${IRCC_CLI_LOG_PATH:-}" ]]; then
    LOG_PATH="${IRCC_CLI_LOG_PATH}"
  fi

  : "${LOG_PATH:=${SCRIPT_DIR}/StatusCheck.txt}"
  if [[ "${LOG_PATH}" != /* ]]; then
    LOG_PATH="${SCRIPT_DIR}/${LOG_PATH#./}"
  fi
  export LOG_PATH
}

iso_date_only() {
  local iso="${1:-}"
  if [[ -z "${iso}" || "${iso}" == "null" ]]; then
    printf '%s\n' ""
    return 0
  fi
  printf '%s\n' "${iso%%T*}"
}

# Parse application-details JSON from stdin into KEY=VALUE lines on stdout.
# Prefers the relation matching UCI_NUMBER, else role==1 (principal applicant).
# Keys: eligibility medical biometrics background last_update sec_date sec_alert
parse_application_details() {
  local json
  json="$(cat)"

  if ! printf '%s' "${json}" | "${JQ_BIN}" -e . >/dev/null 2>&1; then
    die "${EXIT_PARSE}" "Invalid JSON response from IRCC API."
  fi

  local parsed
  # jq program uses --arg-style dollar names; do not expand in shell.
  # shellcheck disable=SC2016
  parsed="$(
    printf '%s' "${json}" | "${JQ_BIN}" -r \
      --arg uci "${UCI_NUMBER:-}" '
      def primary_relation:
        (.relations // [])
        | (map(select((.uci // "") == $uci and $uci != "")) | first)
          // (map(select(.role == 1)) | first)
          // first;

      def acts:
        (primary_relation.activities // {});

      def dig($k):
        [.. | objects | select(has($k)) | .[$k]]
        | map(select(type == "string" and . != ""))
        | first // empty;

      def security_created:
        (
          first(
            (primary_relation.history // [])[]
            | select((.key // "") == "Security")
            | .dateCreated // empty
          )
        )
        // (
          first(
            .. | objects
            | select((.key? // "") == "Security")
            | .dateCreated // empty
          )
        )
        // empty;

      {
        eligibility: (acts.eligibility // dig("eligibility") // "Not available"),
        medical: (acts.medical // dig("medical") // "Not available"),
        biometrics: (acts.biometrics // dig("biometrics") // "Not available"),
        background: (acts.background // dig("background") // "Not available"),
        last_update: (.app.lastUpdated // dig("lastUpdated") // ""),
        sec_date: (security_created // "")
      }
      | to_entries[]
      | "\(.key)=\(.value)"
    '
  )" || die "${EXIT_PARSE}" "Failed to parse application details with jq."

  local eligibility="${NOT_AVAILABLE}"
  local medical="${NOT_AVAILABLE}"
  local biometrics="${NOT_AVAILABLE}"
  local background="${NOT_AVAILABLE}"
  local last_update_raw=""
  local sec_date_raw=""
  local line key value

  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    case "${key}" in
      eligibility) eligibility="${value}" ;;
      medical) medical="${value}" ;;
      biometrics) biometrics="${value}" ;;
      background) background="${value}" ;;
      last_update) last_update_raw="${value}" ;;
      sec_date) sec_date_raw="${value}" ;;
    esac
  done <<<"${parsed}"

  local last_update sec_date sec_alert
  last_update="$(iso_date_only "${last_update_raw}")"
  if [[ -z "${last_update}" ]]; then
    last_update="${NOT_AVAILABLE}"
  fi

  sec_date="$(iso_date_only "${sec_date_raw}")"
  if [[ -z "${sec_date}" ]]; then
    sec_date="${NOT_STARTED}"
    sec_alert="OK (no Security node detected)"
  else
    sec_alert="ALERT (Security review node detected)"
  fi

  printf 'eligibility=%s\n' "${eligibility}"
  printf 'medical=%s\n' "${medical}"
  printf 'biometrics=%s\n' "${biometrics}"
  printf 'background=%s\n' "${background}"
  printf 'last_update=%s\n' "${last_update}"
  printf 'sec_date=%s\n' "${sec_date}"
  printf 'sec_alert=%s\n' "${sec_alert}"
}

cognito_login() {
  local username="$1"
  local password="$2"
  local payload token http_code body tmp

  payload="$(
    # jq --arg binds $client_id / $username / $password inside the filter.
    # shellcheck disable=SC2016
    "${JQ_BIN}" -n \
      --arg client_id "${COGNITO_CLIENT_ID}" \
      --arg username "${username}" \
      --arg password "${password}" \
      '{
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: $client_id,
        AuthParameters: {
          USERNAME: $username,
          PASSWORD: $password
        },
        ClientMetadata: {}
      }'
  )"

  tmp="$(mktemp)"
  http_code="$(
    "${CURL_BIN}" --silent --show-error --location \
      --connect-timeout "${REQUEST_TIMEOUT_SECONDS}" \
      --max-time "${REQUEST_TIMEOUT_SECONDS}" \
      --output "${tmp}" \
      --write-out '%{http_code}' \
      --header 'content-type: application/x-amz-json-1.1' \
      --header 'x-amz-target: AWSCognitoIdentityProviderService.InitiateAuth' \
      --data "${payload}" \
      "${COGNITO_URL}"
  )" || {
    rm -f "${tmp}"
    die "${EXIT_AUTH}" "Login request failed (network or curl error)."
  }

  body="$(cat "${tmp}")"
  rm -f "${tmp}"

  if [[ "${http_code}" != "200" ]]; then
    die "${EXIT_AUTH}" "Login failed (HTTP ${http_code}). Check username/password or IRCC Cognito availability."
  fi

  token="$(printf '%s' "${body}" | "${JQ_BIN}" -r '.AuthenticationResult.IdToken // empty')"
  if [[ -z "${token}" ]]; then
    die "${EXIT_AUTH}" "Login failed: IdToken missing in Cognito response. Check credentials."
  fi

  printf '%s\n' "${token}"
}

fetch_application_details() {
  local token="$1"
  local app_number="$2"
  local uci="$3"
  local payload http_code body tmp

  payload="$(
    # jq --arg binds $app / $uci inside the filter.
    # shellcheck disable=SC2016
    "${JQ_BIN}" -n \
      --arg app "${app_number}" \
      --arg uci "${uci}" \
      '{
        method: "get-application-details",
        applicationNumber: $app,
        uci: $uci,
        isAgent: false
      }'
  )"

  tmp="$(mktemp)"
  http_code="$(
    "${CURL_BIN}" --silent --show-error --location \
      --connect-timeout "${REQUEST_TIMEOUT_SECONDS}" \
      --max-time "${REQUEST_TIMEOUT_SECONDS}" \
      --output "${tmp}" \
      --write-out '%{http_code}' \
      --header "authorization: Bearer ${token}" \
      --header 'content-type: application/json' \
      --data "${payload}" \
      "${IRCC_API_URL}"
  )" || {
    rm -f "${tmp}"
    die "${EXIT_QUERY}" "Status query failed (network or curl error)."
  }

  body="$(cat "${tmp}")"
  rm -f "${tmp}"

  if [[ -z "${body}" ]]; then
    die "${EXIT_QUERY}" "Status query failed: empty response from IRCC API."
  fi

  if [[ "${http_code}" != "200" ]]; then
    die "${EXIT_QUERY}" "Status query failed (HTTP ${http_code}). IRCC API may be unavailable."
  fi

  printf '%s\n' "${body}"
}

fetch_profile_summary() {
  local token="$1"
  local http_code body tmp

  tmp="$(mktemp)"
  http_code="$(
    "${CURL_BIN}" --silent --show-error --location \
      --connect-timeout "${REQUEST_TIMEOUT_SECONDS}" \
      --max-time "${REQUEST_TIMEOUT_SECONDS}" \
      --output "${tmp}" \
      --write-out '%{http_code}' \
      --header "authorization: Bearer ${token}" \
      --header 'content-type: application/json' \
      --data '{"method":"get-profile-summary"}' \
      "${IRCC_API_URL}"
  )" || {
    rm -f "${tmp}"
    die "${EXIT_QUERY}" "Profile summary request failed (network or curl error)."
  }

  body="$(cat "${tmp}")"
  rm -f "${tmp}"

  if [[ -z "${body}" ]]; then
    die "${EXIT_QUERY}" "Profile summary failed: empty response from IRCC API."
  fi

  if [[ "${http_code}" != "200" ]]; then
    die "${EXIT_QUERY}" "Profile summary failed (HTTP ${http_code})."
  fi

  if ! printf '%s' "${body}" | "${JQ_BIN}" -e . >/dev/null 2>&1; then
    die "${EXIT_PARSE}" "Invalid JSON in profile summary response."
  fi

  printf '%s\n' "${body}"
}

# Print applications from get-profile-summary JSON on stdin.
print_application_list() {
  local json
  json="$(cat)"

  # shellcheck disable=SC2016
  printf '%s' "${json}" | "${JQ_BIN}" -r '
    "==================================================",
    "  IRCC applications on this account",
    "==================================================",
    (
      if ((.apps // []) | length) == 0 then
        "  (no applications found)"
      else
        (.apps // [])
        | to_entries[]
        | . as $e
        | (
            "  [\($e.key + 1)] APP_NUMBER: \($e.value.appNum // "N/A")",
            "      Type:        \($e.value.appType // "N/A")",
            "      Status:      \($e.value.status // "N/A")",
            "      Last update: \((($e.value.lastUpdated // "") | split("T")[0]) // "N/A")",
            "      Applicant:   \($e.value.paFirstName // "") \($e.value.paLastName // "")",
            "      Role:        \($e.value.role // "N/A")",
            ""
          )
      end
    ),
    "Tip: set APP_NUMBER in .env to one of the values above,",
    "then run ./ircc-check.sh again.",
    "=================================================="
  '
}

# Assign parsed KEY=VALUE lines into caller-local status fields.
apply_status_kv() {
  local eligibility_ref="$1"
  local medical_ref="$2"
  local biometrics_ref="$3"
  local background_ref="$4"
  local last_update_ref="$5"
  local sec_date_ref="$6"
  local sec_alert_ref="$7"
  local kv="$8"
  local line key value

  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    case "${key}" in
      eligibility) printf -v "${eligibility_ref}" '%s' "${value}" ;;
      medical) printf -v "${medical_ref}" '%s' "${value}" ;;
      biometrics) printf -v "${biometrics_ref}" '%s' "${value}" ;;
      background) printf -v "${background_ref}" '%s' "${value}" ;;
      last_update) printf -v "${last_update_ref}" '%s' "${value}" ;;
      sec_date) printf -v "${sec_date_ref}" '%s' "${value}" ;;
      sec_alert) printf -v "${sec_alert_ref}" '%s' "${value}" ;;
    esac
  done <<<"${kv}"
}

format_report() {
  local time_now="$1"
  local last_update="$2"
  local sec_alert="$3"
  local sec_date="$4"
  local eligibility="$5"
  local medical="$6"
  local biometrics="$7"
  local background="$8"

  cat <<EOF
==================================================
         Query time: ${time_now}
==================================================
  System last update: ${last_update}
  Security alert:     ${sec_alert}
  Security start date: ${sec_date}
--------------------------------------------------
  Module progress:
    - Eligibility: ${eligibility}
    - Medical:     ${medical}
    - Biometrics:  ${biometrics}
    - Background:  ${background}
==================================================
EOF
}

append_log() {
  local log_path="$1"
  shift
  {
    format_report "$@"
    printf '\n'
  } >>"${log_path}"
}

append_raw_json() {
  local log_path="$1"
  local label="$2"
  local json="$3"

  {
    printf '%s\n' "----- RAW JSON (${label}) -----"
    printf '%s' "${json}" | "${JQ_BIN}" '.'
    printf '\n%s\n\n' "----- END RAW JSON -----"
  } >>"${log_path}"
}

# Render application-details JSON to HTML report.
render_html_report() {
  local json="$1"
  local out_path="$2"
  local generated_at
  generated_at="$(date '+%Y-%m-%d %H:%M:%S')"

  if [[ ! -f "${RENDER_JQ}" ]]; then
    die "${EXIT_DEPENDENCY}" "HTML render engine not found: ${RENDER_JQ}"
  fi
  if [[ ! -f "${IRCC_REFERENCE_JSON}" ]]; then
    die "${EXIT_DEPENDENCY}" "Reference data not found: ${IRCC_REFERENCE_JSON}"
  fi

  printf '%s' "${json}" | "${JQ_BIN}" -r \
    --arg generated_at "${generated_at}" \
    --arg focus_uci "${UCI_NUMBER:-}" \
    --slurpfile ref "${IRCC_REFERENCE_JSON}" \
    -f "${RENDER_JQ}" \
    >"${out_path}" || die "${EXIT_PARSE}" "Failed to render HTML report."
}

print_console_summary() {
  local sec_alert="$1"
  local sec_date="$2"
  local background="$3"
  local log_path="$4"

  success "=================================================="
  success "              Query succeeded"
  success "=================================================="
  printf '  Security:   %s\n' "${sec_alert}"
  printf '  Start:      %s\n' "${sec_date}"
  printf '  Background: %s\n' "${background}"
  printf '%s\n' "--------------------------------------------------"
  printf '  Full report appended to: %s\n' "${log_path}"
  if [[ -n "${5:-}" ]]; then
    printf '  HTML report written to:  %s\n' "$5"
  fi
  success "=================================================="
}

usage() {
  cat <<'EOF'
Usage: ircc-check.sh [options]

Options:
  --list              List all applications on this account (shows APP_NUMBER)
  --env-file PATH     Path to .env file (default: ./.env next to this script)
  --log-path PATH     Override text log file path
  --report-path PATH  Override HTML report path (default: ./StatusReport.html)
  --parse-file PATH   Parse a saved application-details JSON file (no network)
  --render-json PATH  Render a saved JSON file to HTML (no network)
  -h, --help          Show this help

Exit codes:
  0  success
  2  usage error
  3  config error
  4  missing dependency
  5  authentication failure
  6  query failure
  7  parse failure
EOF
}

run_parse_file() {
  local path="$1"
  [[ -f "${path}" ]] || die "${EXIT_USAGE}" "Parse fixture not found: ${path}"
  parse_application_details <"${path}"
}

run_render_json() {
  local path="$1"
  [[ -f "${path}" ]] || die "${EXIT_USAGE}" "JSON file not found: ${path}"
  require_commands "${JQ_BIN}"
  local json
  json="$(cat "${path}")"
  render_html_report "${json}" "${HTML_REPORT_PATH}"
  success "HTML report written to: ${HTML_REPORT_PATH}"
}

run_list() {
  require_commands "${CURL_BIN}" "${JQ_BIN}"
  load_env_file "${ENV_FILE}"
  validate_config 0

  info "Logging in to IRCC Tracker..."
  local token
  token="$(cognito_login "${TRACKER_USERNAME}" "${TRACKER_PASSWORD}")"

  info "Fetching application list..."
  local summary_json
  summary_json="$(fetch_profile_summary "${token}")"
  print_application_list <<<"${summary_json}"

  # Also dump full summary JSON into the status log for inspection.
  if [[ -n "${IRCC_CLI_LOG_PATH:-}" ]]; then
    LOG_PATH="${IRCC_CLI_LOG_PATH}"
  fi
  : "${LOG_PATH:=${SCRIPT_DIR}/StatusCheck.txt}"
  if [[ "${LOG_PATH}" != /* ]]; then
    LOG_PATH="${SCRIPT_DIR}/${LOG_PATH#./}"
  fi
  {
    printf '%s\n' "=================================================="
    printf '%s\n' "         List time: $(date '+%Y-%m-%d %H:%M:%S')"
    printf '%s\n' "=================================================="
    printf '\n'
  } >>"${LOG_PATH}"
  append_raw_json "${LOG_PATH}" "get-profile-summary" "${summary_json}"
  printf '  Full list JSON appended to: %s\n' "${LOG_PATH}"
}

run_check() {
  require_commands "${CURL_BIN}" "${JQ_BIN}"
  load_env_file "${ENV_FILE}"
  validate_config 1

  info "Logging in to IRCC Tracker..."
  local token
  token="$(cognito_login "${TRACKER_USERNAME}" "${TRACKER_PASSWORD}")"

  info "Fetching application status..."
  local status_json
  status_json="$(fetch_application_details "${token}" "${APP_NUMBER}" "${UCI_NUMBER}")"

  local status_kv
  status_kv="$(printf '%s' "${status_json}" | parse_application_details)"

  local eligibility="" medical="" biometrics="" background="" last_update="" sec_date="" sec_alert=""
  apply_status_kv eligibility medical biometrics background last_update sec_date sec_alert "${status_kv}"

  local time_now
  time_now="$(date '+%Y-%m-%d %H:%M:%S')"

  append_log "${LOG_PATH}" \
    "${time_now}" \
    "${last_update}" \
    "${sec_alert}" \
    "${sec_date}" \
    "${eligibility}" \
    "${medical}" \
    "${biometrics}" \
    "${background}"

  append_raw_json "${LOG_PATH}" "get-application-details ${APP_NUMBER}" "${status_json}"

  render_html_report "${status_json}" "${HTML_REPORT_PATH}"

  print_console_summary "${sec_alert}" "${sec_date}" "${background}" "${LOG_PATH}" "${HTML_REPORT_PATH}"
}

main() {
  local parse_file=""
  local render_json=""
  local cli_log_path=""
  local do_list=0

  while (($# > 0)); do
    case "$1" in
      --list)
        do_list=1
        shift
        ;;
      --env-file)
        [[ $# -ge 2 ]] || die "${EXIT_USAGE}" "--env-file requires a path"
        ENV_FILE="$2"
        shift 2
        ;;
      --log-path)
        [[ $# -ge 2 ]] || die "${EXIT_USAGE}" "--log-path requires a path"
        cli_log_path="$2"
        shift 2
        ;;
      --report-path)
        [[ $# -ge 2 ]] || die "${EXIT_USAGE}" "--report-path requires a path"
        HTML_REPORT_PATH="$2"
        shift 2
        ;;
      --parse-file)
        [[ $# -ge 2 ]] || die "${EXIT_USAGE}" "--parse-file requires a path"
        parse_file="$2"
        shift 2
        ;;
      --render-json)
        [[ $# -ge 2 ]] || die "${EXIT_USAGE}" "--render-json requires a path"
        render_json="$2"
        shift 2
        ;;
      -h | --help)
        usage
        exit "${EXIT_OK}"
        ;;
      *)
        die "${EXIT_USAGE}" "Unknown option: $1"
        ;;
    esac
  done

  if [[ -n "${parse_file}" ]]; then
    require_commands "${JQ_BIN}"
    run_parse_file "${parse_file}"
    exit "${EXIT_OK}"
  fi

  if [[ -n "${render_json}" ]]; then
    run_render_json "${render_json}"
    exit "${EXIT_OK}"
  fi

  if [[ -n "${cli_log_path}" ]]; then
    # CLI --log-path wins over LOG_PATH from .env
    export IRCC_CLI_LOG_PATH="${cli_log_path}"
  fi

  if ((do_list == 1)); then
    run_list
    exit "${EXIT_OK}"
  fi

  run_check
}

# Allow tests to source this file without executing main.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
