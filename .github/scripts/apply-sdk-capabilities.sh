#!/usr/bin/env bash
#
# Validate a comma-separated capability list against the SDKCapability union in
# packages/shared/src/sdk-versioning/types.ts and set it on a specific version
# entry in that SDK's sdk-versions JSON.
#
# Usage: apply-sdk-capabilities.sh <repo_root> <sdk> <version> <capabilities_csv>
#
# Exit codes:
#   0  capabilities applied (edited the JSON)
#   2  empty capability list -> nothing to do (version-only)
#   3  one or more capabilities are not in types.ts (no changes made)
#   1  usage / structural error
#
# On success (0) and no-op (2) it prints "applied=<csv>" so the caller can echo
# it back. On rejection (3) it prints "invalid=<csv>".
set -euo pipefail

ROOT="${1:?repo_root}"
SDK="${2:?sdk}"
VERSION="${3:?version}"
CSV="${4-}"

TYPES="$ROOT/packages/shared/src/sdk-versioning/types.ts"
[ -f "$TYPES" ] || { echo "types.ts not found at $TYPES" >&2; exit 1; }

# SDK key -> filename (a few keys don't map 1:1 to their file).
case "$SDK" in
  android)  FILE_STEM=kotlin ;;
  ios)      FILE_STEM=swift ;;
  nocode-*) FILE_STEM=nocode ;;
  *)        FILE_STEM="$SDK" ;;
esac
FILE="$ROOT/packages/shared/src/sdk-versioning/sdk-versions/$FILE_STEM.json"
[ -f "$FILE" ] || { echo "no sdk-versions file for '$SDK' ($FILE)" >&2; exit 1; }

# The version entry the PR added must exist.
if ! jq -e --arg v "$VERSION" '.versions[] | select(.version == $v)' "$FILE" >/dev/null; then
  echo "version $VERSION not present in $FILE" >&2; exit 1
fi

# The single source of truth for valid capabilities: the SDKCapability union.
VALID="$(sed -n '/export type SDKCapability =/,/;/p' "$TYPES" | grep -oE '"[A-Za-z0-9]+"' | tr -d '"')"

# Parse + trim the CSV. Empty -> no-op (version-only).
CLEANED="$(echo "$CSV" | tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' || true)"
if [ -z "$CLEANED" ]; then
  echo "applied="
  exit 2
fi

invalid=""
while IFS= read -r cap; do
  grep -qx "$cap" <<< "$VALID" || invalid="${invalid:+$invalid, }$cap"
done <<< "$CLEANED"

if [ -n "$invalid" ]; then
  echo "invalid=$invalid"
  exit 3
fi

# Build a JSON array from the validated, de-duplicated (order-preserving) list.
CAPS_JSON="$(echo "$CLEANED" | awk '!seen[$0]++' | jq -R . | jq -sc .)"

# Set capabilities on exactly the target version entry. `(...) |= ` mutates in place.
tmp="$(mktemp)"
jq --arg v "$VERSION" --argjson caps "$CAPS_JSON" \
  '(.versions[] | select(.version == $v)).capabilities = $caps' "$FILE" > "$tmp"
mv "$tmp" "$FILE"

echo "applied=$(echo "$CLEANED" | awk '!seen[$0]++' | paste -sd ',' -)"
exit 0
