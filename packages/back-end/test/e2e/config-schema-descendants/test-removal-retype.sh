#!/usr/bin/env bash
# E2E: ancestor removal / retype / takeover under descendant overrides (ask 2).
#
# The report: with the base's own value clean, removing a field a child still
# overrides published 200-silent (child left orphaned, flagged nowhere in an
# extensible family), and retyping under a child's override was silent too. Now
# every destructive-to-descendants publish soft-blocks (422 SoftWarningError,
# bypassable with ?ignoreWarnings=true) enumerating the impact, and the lineage
# endpoint flags the aftermath per node:
#   - removal under an override  → gate + `orphanedFields` on the child
#   - retype under an override   → gate + `incompatibleFields` on the child
#   - add over a DIFFERING child declaration (cascade would drop it) → gate
#   - add over an IDENTICAL child declaration → no gate (lossless strip)
#   - purely additive change → no gate
#
# Usage: GB_API_KEY=... ./test-removal-retype.sh

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
trap cleanup EXIT

preflight

BASE="rmv_${RUN_ID}_base"
CHILD="rmv_${RUN_ID}_child"

# Precomputed schema sources (see test-redeclare-strip.sh for why).
S_INITIAL=$(json_schema '{
  "timeout_ms": {"type": "integer"},
  "retries": {"type": "integer"},
  "mode": {"type": "string"}
}')
S_ADDITIVE=$(json_schema '{
  "timeout_ms": {"type": "integer"},
  "retries": {"type": "integer"},
  "mode": {"type": "string"},
  "brand_new": {"type": "string"}
}')
S_REMOVED=$(json_schema '{
  "timeout_ms": {"type": "integer"},
  "mode": {"type": "string"},
  "brand_new": {"type": "string"}
}')
S_CHILD_TTL=$(json_schema '{"cache_ttl": {"type": "string"}}')
S_TAKEOVER=$(json_schema '{
  "timeout_ms": {"type": "integer"},
  "mode": {"type": "string"},
  "brand_new": {"type": "string"},
  "cache_ttl": {"type": "integer"}
}')
S_CHILD_PX=$(json_schema '{"px_ratio": {"type": "integer"}}')
S_IDENTICAL_ADD=$(json_schema '{
  "timeout_ms": {"type": "integer"},
  "mode": {"type": "string"},
  "brand_new": {"type": "string"},
  "cache_ttl": {"type": "integer"},
  "px_ratio": {"type": "integer"}
}')
S_RETYPED=$(json_schema '{
  "timeout_ms": {"type": "integer"},
  "mode": {"type": "integer"},
  "brand_new": {"type": "string"},
  "cache_ttl": {"type": "integer"},
  "px_ratio": {"type": "integer"}
}')

echo "Setup: base owns timeout_ms/retries/mode (own value clean); child overrides retries + mode"
create_config "$BASE" "$(jq -n --argjson schema "$S_INITIAL" \
  '{schema: $schema, value: {timeout_ms: 30}}')"
create_config "$CHILD" "$(jq -n --arg parent "$BASE" \
  '{parent: $parent, value: {retries: 5, mode: "turbo"}}')"

echo
echo "Purely additive changes do not gate"
update_config "$BASE" "$(jq -n --argjson schema "$S_ADDITIVE" '{schema: $schema}')"
expect_status 200 "adding an unused field publishes without a gate"

echo
echo "Removal under a descendant override soft-blocks, then bypasses"
update_config "$BASE" "$(jq -n --argjson schema "$S_REMOVED" '{schema: $schema}')"
expect_soft_gate 'overrides removed field(s) "retries"' \
  "removing an overridden field → 422 naming the impact"
if res_message | grep -qF "\"$CHILD\" ($CHILD)"; then
  ok "…and the impacted descendant"
else
  fail "…and the impacted descendant"
fi

update_config "$BASE" "$(jq -n --argjson schema "$S_REMOVED" '{schema: $schema}')" \
  "?ignoreWarnings=true"
expect_status 200 "same removal with ?ignoreWarnings=true → 200"
saved_schema_has "$BASE" "retries" "false" "base schema no longer declares retries"

lineage_node_field "$BASE" "$CHILD" '.orphanedFields | index("retries") != null'
if [ "$RES_BODY" = "true" ]; then
  ok "lineage flags the child's orphaned retries override (previously flagged nowhere in an extensible family)"
else
  fail "lineage flags the child's orphaned retries override (got: $RES_BODY)"
fi

echo
echo "A destructive add (child declares the key DIFFERENTLY) soft-blocks"
update_config "$CHILD" "$(jq -n --argjson schema "$S_CHILD_TTL" '{schema: $schema}')"
expect_status 200 "child declares its own cache_ttl (string)"
update_config "$BASE" "$(jq -n --argjson schema "$S_TAKEOVER" '{schema: $schema}')"
expect_soft_gate 'declares conflicting field(s) "cache_ttl" that would be dropped' \
  "base adding cache_ttl (integer) over the child's string → 422"
update_config "$BASE" "$(jq -n --argjson schema "$S_TAKEOVER" '{schema: $schema}')" \
  "?ignoreWarnings=true"
expect_status 200 "bypassed → 200; cascade takes ownership"
saved_schema_has "$CHILD" "cache_ttl" "false" \
  "child's conflicting declaration was cascade-stripped (base wins)"

echo
echo "An identical add does NOT gate (lossless strip)"
update_config "$CHILD" "$(jq -n --argjson schema "$S_CHILD_PX" '{schema: $schema}')"
expect_status 200 "child declares its own px_ratio (integer)"
update_config "$BASE" "$(jq -n --argjson schema "$S_IDENTICAL_ADD" '{schema: $schema}')"
expect_status 200 "base adding an identical px_ratio publishes straight through (no 422)"
saved_schema_has "$CHILD" "px_ratio" "false" \
  "child's identical declaration was cascade-stripped (nothing lost)"

echo
echo "Retype under a descendant override soft-blocks, then flags read-time"
update_config "$BASE" "$(jq -n --argjson schema "$S_RETYPED" '{schema: $schema}')"
expect_soft_gate 'no longer match retyped field(s) "mode"' \
  "retyping mode (string→integer) under the child's \"turbo\" → 422"
update_config "$BASE" "$(jq -n --argjson schema "$S_RETYPED" '{schema: $schema}')" \
  "?ignoreWarnings=true"
expect_status 200 "same retype with ?ignoreWarnings=true → 200"

lineage_node_field "$BASE" "$CHILD" '.incompatibleFields | index("mode") != null'
if [ "$RES_BODY" = "true" ]; then
  ok "lineage flags the child's now-incompatible mode override"
else
  fail "lineage flags the child's now-incompatible mode override (got: $RES_BODY)"
fi
lineage_node_field "$BASE" "$CHILD" '.orphanedFields | index("retries") != null'
if [ "$RES_BODY" = "true" ]; then
  ok "…while still flagging the orphaned retries override"
else
  fail "…while still flagging the orphaned retries override (got: $RES_BODY)"
fi

summary
