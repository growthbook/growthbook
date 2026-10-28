#!/usr/bin/env bash
# Manual end-to-end check for API_ORG_CACHE_MAX_AGE_MS.
#
# Boots the compiled back-end (dist/server.js) against a throwaway Mongo with
# the org cache on, then checks through the REST API that:
#   1. repeated GETs work,
#   2. a change made through the app (internal API) or a REST write is visible
#      on the very next GET,
#   3. a direct database edit (no changeStamp) stays hidden until the cached
#      copy reaches the max age, then shows up.
#
# Needs docker, curl and jq. Build first (`pnpm --filter back-end build`, or
# `npx swc src --out-dir dist` from packages/back-end), then run:
#   packages/back-end/scripts/org-cache-e2e.sh
set -euo pipefail

cd "$(dirname "$0")/.."

MONGO_PORT=${MONGO_PORT:-27091}
API_PORT=${API_PORT:-3191}
MAX_AGE_MS=${MAX_AGE_MS:-15000}
CONTAINER=gb-org-cache-e2e-$$
LOG=$(mktemp -t org-cache-e2e.XXXXXX)
BASE=http://localhost:$API_PORT
SERVER_PID=""
PASSED=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [ -n "$PASSED" ]; then
    rm -f "$LOG"
  else
    echo "server log kept at $LOG" >&2
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*"
  echo "--- end of server log:"
  tail -30 "$LOG"
  exit 1
}

docker run -d --rm --name "$CONTAINER" -p "$MONGO_PORT:27017" mongo:7 >/dev/null
for _ in $(seq 1 120); do
  docker exec "$CONTAINER" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && break
  [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = true ] || fail "mongo container exited"
  sleep 0.5
done
docker exec "$CONTAINER" mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 || fail "mongo never became ready"

mongo() {
  docker exec "$CONTAINER" mongosh --quiet gb_org_cache_e2e --eval "$1"
}

# These keys are pinned so a local .env.local can't override them
MONGODB_URI="mongodb://localhost:$MONGO_PORT/gb_org_cache_e2e" \
  LICENSE_KEY='' \
  IS_CLOUD=false \
  IS_MULTI_ORG=false \
  SECRET_API_KEY='' \
  EMAIL_ENABLED=false \
  BACKEND_PORT=$API_PORT \
  APP_ORIGIN=http://localhost:3000 \
  API_ORG_CACHE_MAX_AGE_MS=$MAX_AGE_MS \
  JWT_SECRET=org-cache-e2e-jwt \
  ENCRYPTION_KEY=org-cache-e2e-encryption \
  DISABLE_PYTHON_MONITOR=true \
  GB_STATS_ENGINE_MIN_POOL_SIZE=0 \
  CRON_DISABLED=true \
  node --no-node-snapshot dist/server.js >"$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 120); do
  curl -sf "$BASE/healthcheck" >/dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2>/dev/null || fail "server exited"
  sleep 0.5
done
curl -sf "$BASE/healthcheck" >/dev/null || fail "server never became healthy"

# First user + org on a fresh install, then an admin secret key
JWT=$(curl -sf -X POST "$BASE/auth/firsttime" -H 'Content-Type: application/json' \
  -d '{"email":"e2e@example.com","name":"E2E","password":"Org-cache-e2e-1","companyname":"Cache Org"}' |
  jq -r .token)
[ -n "$JWT" ] && [ "$JWT" != null ] || fail "no session token"
ORG_ID=$(mongo 'db.organizations.findOne().id')
internal() {
  local method=$1 path=$2 body=${3:-}
  curl -sS -X "$method" "$BASE$path" -H "Authorization: Bearer $JWT" \
    -H "X-Organization: $ORG_ID" \
    -H 'Content-Type: application/json' ${body:+-d "$body"}
}
KEY_RES=$(internal POST /keys '{"type":"admin","description":"e2e"}')
SECRET=$(echo "$KEY_RES" | jq -r .key.key)
[[ "$SECRET" == secret_* ]] || fail "no API key: $KEY_RES"

# Prints the body; on an error status, says which request failed and returns 1
rest() {
  local method=$1 path=$2 body=${3:-} out code
  out=$(curl -sS -w '\n%{http_code}' -X "$method" "$BASE/api/v1$path" \
    -H "Authorization: Bearer $SECRET" \
    -H 'Content-Type: application/json' ${body:+-d "$body"}) || {
    echo "request failed: $method /api/v1$path" >&2
    return 1
  }
  code=${out##*$'\n'}
  out=${out%$'\n'*}
  if [ "$code" -ge 400 ]; then
    echo "$method /api/v1$path returned $code: $out" >&2
    return 1
  fi
  printf '%s\n' "$out"
}
attrs() { rest GET /attributes | jq -r '[.attributes[].property] | sort | join(",")'; }
has_attr() {
  rest GET /attributes | jq -e --arg p "$1" 'any(.attributes[]; .property == $p)' >/dev/null
}

echo "1. two GETs"
A1=$(attrs)
A2=$(attrs)
[ "$A1" = "$A2" ] || fail "repeated GETs differ: $A1 / $A2"
has_attr utmSource || fail "default attributes missing: $A1"

echo "2a. change through the app is visible on the next GET"
internal POST /attribute \
  '{"property":"viaApp","datatype":"string","projects":[]}' >/dev/null
has_attr viaApp || fail "app write not visible: $(attrs)"

echo "2b. REST write is visible on the next GET"
rest POST /attributes '{"property":"viaRest","datatype":"string"}' >/dev/null
has_attr viaRest || fail "REST write not visible: $(attrs)"

echo "3. direct DB edit is stale until max age, then fresh"
# mongosh through docker exec takes a second or two, so the stamp is read
# before the cached copy is refreshed and the clock starts.
STAMP_BEFORE=$(mongo 'db.organizations.findOne({}, {changeStamp: 1}).changeStamp')
START=$(date +%s)
attrs >/dev/null # cache a copy now; it may be reused for MAX_AGE_MS
# shellcheck disable=SC2016 # $push is a Mongo operator, not a shell variable
mongo 'db.organizations.updateOne({}, {$push: {"settings.attributeSchema": {property: "viaDb", datatype: "string"}}})' >/dev/null
STAMP_AFTER=$(mongo 'db.organizations.findOne({}, {changeStamp: 1}).changeStamp')
[ "$STAMP_BEFORE" = "$STAMP_AFTER" ] || fail "raw edit changed the stamp"
if has_attr viaDb; then
  [ $(($(date +%s) - START)) -lt $((MAX_AGE_MS / 1000)) ] || fail "too slow to check staleness; raise MAX_AGE_MS"
  fail "direct DB edit visible before max age (cache not in use?)"
fi
SEEN=""
while [ $(($(date +%s) - START)) -lt $((MAX_AGE_MS / 1000 + 5)) ]; do
  if has_attr viaDb; then
    SEEN=$(($(date +%s) - START))
    break
  fi
  sleep 0.5
done
[ -n "$SEEN" ] || fail "direct DB edit never became visible"
echo "   visible after ~${SEEN}s (max age ${MAX_AGE_MS}ms)"

PASSED=1
echo "PASS"
