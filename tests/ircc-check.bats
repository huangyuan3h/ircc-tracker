#!/usr/bin/env bats

setup() {
  PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  SCRIPT="${PROJECT_ROOT}/ircc-check.sh"
  FIXTURES="${PROJECT_ROOT}/tests/fixtures"
  TMP_DIR="$(mktemp -d)"
}

teardown() {
  rm -rf "${TMP_DIR}"
}

@test "help prints usage and exits 0" {
  run "${SCRIPT}" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage: ircc-check.sh"* ]]
}

@test "missing env file exits with config error" {
  run "${SCRIPT}" --env-file "${TMP_DIR}/missing.env"
  [ "$status" -eq 3 ]
  [[ "$output" == *"Config file not found"* ]]
}

@test "incomplete env file exits with config error" {
  cat >"${TMP_DIR}/partial.env" <<'EOF'
TRACKER_USERNAME=test-user
TRACKER_PASSWORD=
APP_NUMBER=S123
UCI_NUMBER=11-1111-1111
EOF
  run "${SCRIPT}" --env-file "${TMP_DIR}/partial.env"
  [ "$status" -eq 3 ]
  [[ "$output" == *"Missing required config value"* ]]
}

@test "parse-file extracts modules and security date" {
  export UCI_NUMBER="11-1111-1111"
  run "${SCRIPT}" --parse-file "${FIXTURES}/application-details.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"eligibility=completed"* ]]
  [[ "$output" == *"medical=inProgress"* ]]
  [[ "$output" == *"biometrics=completed"* ]]
  [[ "$output" == *"background=notStarted"* ]]
  [[ "$output" == *"last_update=2026-03-15"* ]]
  [[ "$output" == *"sec_date=2026-02-01"* ]]
  [[ "$output" == *"sec_alert=ALERT (Security review node detected)"* ]]
}

@test "parse-file reports missing security as not started" {
  export UCI_NUMBER="22-2222-2222"
  run "${SCRIPT}" --parse-file "${FIXTURES}/application-details-no-security.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"eligibility=completed"* ]]
  [[ "$output" == *"medical=notStarted"* ]]
  [[ "$output" == *"biometrics=notStarted"* ]]
  [[ "$output" == *"background=notStarted"* ]]
  [[ "$output" == *"last_update=2026-04-01"* ]]
  [[ "$output" == *"sec_date=Not started"* ]]
  [[ "$output" == *"sec_alert=OK (no Security node detected)"* ]]
}

@test "parse-file rejects invalid JSON" {
  printf 'not-json' >"${TMP_DIR}/bad.json"
  run "${SCRIPT}" --parse-file "${TMP_DIR}/bad.json"
  [ "$status" -eq 7 ]
  [[ "$output" == *"Invalid JSON"* ]]
}

@test "render-json writes HTML report" {
  run "${SCRIPT}" --render-json "${FIXTURES}/application-details.json" --report-path "${TMP_DIR}/out.html"
  [ "$status" -eq 0 ]
  [ -f "${TMP_DIR}/out.html" ]
  grep -q "IRCC Application Status" "${TMP_DIR}/out.html"
  grep -q "S300000000" "${TMP_DIR}/out.html"
  grep -q "Security / background review" "${TMP_DIR}/out.html"
}

@test "iso_date_only strips time component" {
  # shellcheck source=/dev/null
  source "${SCRIPT}"
  run iso_date_only "2026-02-01T12:34:56.000Z"
  [ "$status" -eq 0 ]
  [ "$output" = "2026-02-01" ]
}

@test "iso_date_only handles empty values" {
  # shellcheck source=/dev/null
  source "${SCRIPT}"
  run iso_date_only ""
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
