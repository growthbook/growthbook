#!/usr/bin/env bash
# Runs the descendant-aware config schema E2E suites against a live back-end.
#
#   GB_API_KEY=secret_... ./run-all.sh
#
# Optional: GB_API_HOST=http://localhost:3101 (defaults to API_HOST from
# packages/front-end/.env.local, then http://localhost:3100).

set -u
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

FAILED=0
for suite in test-redeclare-strip.sh test-removal-retype.sh test-rule-refs.sh; do
  echo
  echo "=== $suite ==="
  "$SCRIPT_DIR/$suite" || FAILED=1
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "All suites passed."
else
  echo "One or more suites FAILED."
fi
exit "$FAILED"
