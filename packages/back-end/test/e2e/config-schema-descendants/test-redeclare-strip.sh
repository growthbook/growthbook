#!/usr/bin/env bash
# E2E: ancestor-owned field re-declarations (the silent-strip report, ask 1).
#
# The original incident: a child schema re-declaring `stream_priority` with a
# narrowed enum returned 200 while the field was silently stripped. Now:
#   - a re-declaration whose contract DIFFERS from the ancestor's → 400 naming
#     the field and owning ancestor (create AND update paths)
#   - a contract-IDENTICAL re-declaration (full effective-schema import) →
#     200, stripped, with a `redundant-declaration` warning; own fields kept
#   - a description-only difference still counts as identical (docs ≠ contract)
#   - verifyConfigSchema pre-flights the same classification read-only via
#     `ancestorOwnedFields: [{key, ownedBy, identical}]` — it no longer skips
#     the ancestor normalization
#
# Usage: GB_API_KEY=... ./test-redeclare-strip.sh

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
trap cleanup EXIT

preflight

BASE="strip_${RUN_ID}_base"
CHILD="strip_${RUN_ID}_child"

# Schema sources, precomputed (macOS bash 3.2 mangles escaped quotes inside
# nested command substitutions, so build every JSON blob in a variable first).
S_BASE=$(json_schema '{
  "stream_priority": {"type": "string", "enum": ["low", "high", "realtime"]},
  "timeout_ms": {"type": "integer"}
}')
S_NARROW=$(json_schema '{
  "stream_priority": {"type": "string", "enum": ["low", "high"]}
}')
S_RETYPE=$(json_schema '{"timeout_ms": {"type": "string"}}')
S_FULL_IMPORT=$(json_schema '{
  "stream_priority": {"type": "string", "enum": ["low", "high", "realtime"]},
  "timeout_ms": {"type": "integer"},
  "child_note": {"type": "string"}
}')
S_DESC_ONLY=$(json_schema '{
  "timeout_ms": {"type": "integer", "description": "my own words"},
  "child_note": {"type": "string"}
}')
S_VERIFY_IDENTICAL=$(json_schema '{
  "stream_priority": {"type": "string", "enum": ["low", "high", "realtime"]},
  "child_note": {"type": "string"}
}')

echo "Setup: base config owning stream_priority (enum) and timeout_ms"
create_config "$BASE" "$(jq -n --argjson schema "$S_BASE" \
  '{schema: $schema, value: {stream_priority: "high", timeout_ms: 30}}')"

echo
echo "Conflicting re-declaration (the narrowing attempt) rejects"
api POST /configs "$(jq -n --arg key "$CHILD" --arg parent "$BASE" \
  --argjson schema "$S_NARROW" \
  '{key: $key, name: $key, parent: $parent, schema: $schema}')"
expect_conflict_rejection "stream_priority" "$BASE" \
  "create: child schema narrowing the base enum → 400 naming field + ancestor"
if res_message | grep -qF "override a field's value but not its schema"; then
  ok "rejection explains the value-vs-schema rule"
else
  fail "rejection explains the value-vs-schema rule"
fi

create_config "$CHILD" "$(jq -n --arg parent "$BASE" \
  '{parent: $parent, value: {stream_priority: "low"}}')"
expect_status 200 "create: same child without the re-declaration → 200"

update_config "$CHILD" "$(jq -n --argjson schema "$S_NARROW" '{schema: $schema}')"
expect_conflict_rejection "stream_priority" "$BASE" \
  "update: re-declaring with a narrowed enum → 400 naming field + ancestor"

update_config "$CHILD" "$(jq -n --argjson schema "$S_RETYPE" '{schema: $schema}')"
expect_conflict_rejection "timeout_ms" "$BASE" \
  "update: re-declaring with a retyped field (int→string) → 400"

echo
echo "Identical re-declaration (full effective-schema import) strips with a warning"
update_config "$CHILD" "$(jq -n --argjson schema "$S_FULL_IMPORT" '{schema: $schema}')"
expect_status 200 "importing the full effective schema (incl. own field) → 200"
expect_warning_code "redundant-declaration" \
  "response warns about the stripped identical re-declarations"
saved_schema_has "$CHILD" "stream_priority" "false" \
  "saved child schema does NOT re-declare stream_priority (stripped)"
saved_schema_has "$CHILD" "child_note" "true" \
  "saved child schema keeps its own child_note field"

echo
echo "Description-only differences are docs, not contract"
update_config "$CHILD" "$(jq -n --argjson schema "$S_DESC_ONLY" '{schema: $schema}')"
expect_status 200 "re-declaring with only a different description → 200 (identical)"
expect_warning_code "redundant-declaration" "…still warned about the strip"

echo
echo "verifyConfigSchema pre-flights the classification (read-only)"
api POST "/configs/$CHILD/schema/verify" \
  "$(jq -n --argjson schema "$S_VERIFY_IDENTICAL" '{schema: $schema}')"
expect_status 200 "verify with an identical inherited field → 200 (never rejects)"
expect_json '[.ancestorOwnedFields[]? | select(.key == "stream_priority")][0].ownedBy' \
  "$BASE" "verify names the owning ancestor"
expect_json '[.ancestorOwnedFields[]? | select(.key == "stream_priority")][0].identical' \
  "true" "verify classifies the identical re-declaration (would strip harmlessly)"
expect_warning_code "redundant-declaration" "verify carries the strip warning too"

api POST "/configs/$CHILD/schema/verify" \
  "$(jq -n --argjson schema "$S_NARROW" '{schema: $schema}')"
expect_status 200 "verify with a narrowed enum → still 200 (pre-flight, not a write)"
expect_json '[.ancestorOwnedFields[]? | select(.key == "stream_priority")][0].identical' \
  "false" "verify classifies the narrowing as conflicting (a save would 400)"

summary
