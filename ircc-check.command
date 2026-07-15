#!/usr/bin/env bash
# macOS double-click launcher for IRCC Tracker checker.
# Keeps the Terminal window open so results are readable.

set -Eeuo pipefail

cd "$(dirname "$0")"

CYAN=$'\033[0;36m'
RED=$'\033[0;31m'
NC=$'\033[0m'

pause() {
  printf '\n'
  printf '%sPress any key to close this window...%s\n' "${CYAN}" "${NC}"
  # read may fail under some Terminal settings; ignore errors.
  read -n 1 -s -r || true
}

if [[ ! -f "./ircc-check.sh" ]]; then
  printf '%sircc-check.sh not found next to this launcher.%s\n' "${RED}" "${NC}"
  pause
  exit 1
fi

set +e
./ircc-check.sh "$@"
exit_code=$?
set -e

if ((exit_code != 0)); then
  printf '\n%sCheck failed (exit code %s).%s\n' "${RED}" "${exit_code}" "${NC}"
fi

pause
exit "${exit_code}"
