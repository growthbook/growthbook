#!/usr/bin/env bash
# Shared helpers for the descendant-aware config schema E2E scripts. These
# replay the failure modes from the stakeholder report against a LIVE back-end
# through the REST API — silent ancestor-field strip, silent removal/retype
# under descendant overrides, undeclared rule references — and assert the new
# behavior: conflicting re-declarations reject, identical ones warn, destructive
# publishes soft-block (422 + ?ignoreWarnings=true), lineage flags orphans.
#
# Requirements:
#   - self-hosted back-end with the "feature-configs" premium feature
#   - jq, curl
#
# Environment:
#   GB_API_KEY   secret API key with admin access (Settings → API Keys)  [required]
#   GB_API_HOST  back-end origin; defaults to API_HOST from
#                packages/front-end/.env.local, then http://localhost:3100

set -u

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../../../.." && pwd)

command -v jq >/dev/null 2>&1 || {
  echo "jq is required (brew install jq)" >&2
  exit 1
}

if [ -z "${GB_API_HOST:-}" ]; then
  ENV_FILE="$REPO_ROOT/packages/front-end/.env.local"
  if [ -f "$ENV_FILE" ]; then
    GB_API_HOST=$(sed -n 's/^API_HOST=//p' "$ENV_FILE" | tail -1)
  fi
  GB_API_HOST=${GB_API_HOST:-http://localhost:3100}
fi

if [ -z "${GB_API_KEY:-}" ]; then
  echo "Set GB_API_KEY to a secret API key for the org (Settings → API Keys)" >&2
  exit 1
fi

RUN_ID=$(date +%s)
PASS=0
FAIL=0
RES_STATUS=""
RES_BODY=""
CLEANUP_CONFIGS=""

# ---------- HTTP ----------

api() { # api METHOD PATH [JSON_BODY] → RES_STATUS / RES_BODY
  local method=$1 path=$2 body=${3:-} out
  if [ -n "$body" ]; then
    out=$(curl -sS -X "$method" "$GB_API_HOST/api/v1$path" \
      -H "Authorization: Bearer $GB_API_KEY" \
      -H "Content-Type: application/json" \
      --data "$body" -w $'\n%{http_code}' 2>&1) || {
      RES_STATUS=000
      RES_BODY=$out
      return 0
    }
  else
    out=$(curl -sS -X "$method" "$GB_API_HOST/api/v1$path" \
      -H "Authorization: Bearer $GB_API_KEY" \
      -w $'\n%{http_code}' 2>&1) || {
      RES_STATUS=000
      RES_BODY=$out
      return 0
    }
  fi
  RES_STATUS=${out##*$'\n'}
  RES_BODY=${out%$'\n'*}
}

# ---------- assertions ----------

ok() {
  PASS=$((PASS + 1))
  printf '  \033[32m✓\033[0m %s\n' "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf '  \033[31m✗\033[0m %s\n' "$1"
  printf '      status=%s body=%.400s\n' "$RES_STATUS" "$RES_BODY"
}

expect_status() { # expect_status CODE DESCRIPTION
  if [ "$RES_STATUS" = "$1" ]; then ok "$2"; else fail "$2 (expected HTTP $1, got $RES_STATUS)"; fi
}

expect_body_contains() { # expect_body_contains TEXT DESCRIPTION
  if printf '%s' "$RES_BODY" | grep -qF "$1"; then
    ok "$2"
  else
    fail "$2 (body missing '$1')"
  fi
}

expect_json() { # expect_json JQ_FILTER EXPECTED DESCRIPTION
  local got
  got=$(printf '%s' "$RES_BODY" | jq -r "$1" 2>/dev/null)
  if [ "$got" = "$2" ]; then ok "$3"; else fail "$3 (expected $1 = '$2', got '$got')"; fi
}

# The error/warning text, un-JSON-escaped: `.message` when the body is JSON,
# else the raw body.
res_message() {
  printf '%s' "$RES_BODY" | jq -r '.message // empty' 2>/dev/null ||
    printf '%s' "$RES_BODY"
}

# The new save-time rejection: 400 whose message names the field and the
# owning ancestor ("owned by") — the $extends-fix analog for the strip.
expect_conflict_rejection() { # expect_conflict_rejection FIELD ANCESTOR DESCRIPTION
  if [ "$RES_STATUS" = "400" ] &&
    res_message | grep -qF "\"$1\" (owned by \"$2\")"; then
    ok "$3"
  else
    fail "$3 (expected 400 naming \"$1\" owned by \"$2\")"
  fi
}

# The new destructive-change gate: 422 SoftWarningError whose message carries
# the given impact line fragment and the ?ignoreWarnings=true hint.
expect_soft_gate() { # expect_soft_gate FRAGMENT DESCRIPTION
  if [ "$RES_STATUS" = "422" ] &&
    res_message | grep -qF "$1" &&
    res_message | grep -q "ignoreWarnings"; then
    ok "$2"
  else
    fail "$2 (expected 422 containing '$1' + ignoreWarnings hint)"
  fi
}

# Structured warning on a 200 write response: `warnings: [{code, message, path?}]`.
expect_warning_code() { # expect_warning_code CODE DESCRIPTION
  local got
  got=$(printf '%s' "$RES_BODY" | jq -r "[.warnings[]?.code] | index(\"$1\") != null" 2>/dev/null)
  if [ "$got" = "true" ]; then ok "$2"; else fail "$2 (no warning with code '$1')"; fi
}

expect_no_warning_code() { # expect_no_warning_code CODE DESCRIPTION
  local got
  got=$(printf '%s' "$RES_BODY" | jq -r "[.warnings[]?.code] | index(\"$1\") == null" 2>/dev/null)
  if [ "$got" = "true" ]; then ok "$2"; else fail "$2 (unexpected warning '$1')"; fi
}

summary() {
  echo
  echo "Results: $PASS passed, $FAIL failed"
  [ "$FAIL" -eq 0 ]
}

# ---------- domain helpers ----------

# create_config KEY BODY_EXTRAS_JSON — creates and registers for cleanup.
# BODY_EXTRAS_JSON is merged over {key, name, extensible: true}.
create_config() {
  local key=$1 extras=${2:-"{}"} body
  body=$(jq -n --arg key "$key" --argjson extras "$extras" \
    '{key: $key, name: $key, extensible: true} + $extras')
  api POST /configs "$body"
  if [ "$RES_STATUS" = "200" ]; then
    # Prepend: cleanup runs newest-first, so children are removed before parents.
    CLEANUP_CONFIGS="$key $CLEANUP_CONFIGS"
  else
    fail "setup: create config $key"
  fi
}

# update_config KEY BODY_JSON [QUERY] — direct publish; bypassApproval keeps the
# scripts working on approval-requiring orgs (admin keys have the bypass).
update_config() {
  local key=$1 body=$2 query=${3:-}
  api POST "/configs/$key${query}" \
    "$(printf '%s' "$body" | jq '. + {bypassApproval: true}')"
}

# json_schema PROPERTIES_JSON — the `{type: "json-schema", value}` source
# envelope around a properties map (no required array; everything optional so
# identical re-declarations stay contract-equal across import round-trips).
json_schema() {
  jq -n --argjson props "$1" \
    '{type: "json-schema", value: {type: "object", properties: $props}}'
}

# saved_schema_has KEY FIELD true|false DESCRIPTION — GET the config and assert
# whether its OWN saved schema declares FIELD.
saved_schema_has() {
  local key=$1 field=$2 expected=$3 desc=$4
  api GET "/configs/$key"
  expect_json ".config.schema.value.properties | has(\"$field\")" "$expected" "$desc"
}

# lineage_node_field KEY NODE JQ_TAIL — jq into one node of KEY's lineage.
lineage_node_field() {
  local key=$1 node=$2 tail=$3
  api GET "/configs/$key/lineage"
  RES_BODY=$(printf '%s' "$RES_BODY" | jq "[.nodes[] | select(.key == \"$node\")][0] | $tail" 2>/dev/null)
}

cleanup() {
  local key
  if [ -n "$CLEANUP_CONFIGS" ]; then
    echo
    echo "Cleaning up..."
  fi
  # Deletes require archive-first; order is children-before-parents.
  for key in $CLEANUP_CONFIGS; do
    api POST "/configs/$key/archive" || true
    api DELETE "/configs/$key" || true
    [ "$RES_STATUS" = "200" ] || echo "  warning: could not delete config $key (status $RES_STATUS)"
  done
}

preflight() {
  echo "Target: $GB_API_HOST (run id $RUN_ID)"
  api GET "/configs?limit=1"
  if [ "$RES_STATUS" != "200" ]; then
    echo "Configs API unavailable (HTTP $RES_STATUS): $(printf '%.200s' "$RES_BODY")" >&2
    echo "Hints: back-end running? plan includes 'feature-configs'? key has admin access?" >&2
    exit 1
  fi
}
