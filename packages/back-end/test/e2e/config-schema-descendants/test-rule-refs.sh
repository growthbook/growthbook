#!/usr/bin/env bash
# E2E: invariant rules vs. undeclared fields (ask 4b + the rule side of ask 2).
#
#   - saving a rule whose field the effective schema doesn't declare → 200 with
#     an `undeclared-rule-field` warning (a typo'd field silently compares
#     against null at evaluation time — now flagged at authoring time)
#   - removing a field a DESCENDANT's rule references → the publish soft-gate
#     names the rule; the bypassed publish also warns that the base's own kept
#     rule now references an undeclared field
#   - control (report point in our favor, unchanged): rules stay protective
#     over orphaned values — a base invariant still rejects a violating child
#     publish after its field was removed from the schema
#
# Usage: GB_API_KEY=... ./test-rule-refs.sh

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
trap cleanup EXIT

preflight

BASE="rule_${RUN_ID}_base"
CHILD="rule_${RUN_ID}_child"

# Precomputed sources (see test-redeclare-strip.sh for why).
S_REPLICAS=$(json_schema '{
  "min_replicas": {"type": "integer"},
  "max_replicas": {"type": "integer"}
}')
S_MIN_ONLY=$(json_schema '{"min_replicas": {"type": "integer"}}')
ORDER_RULE='{"min_replicas": {"$lte": {"$ref": "max_replicas"}}}'
# The report's motif: a typo'd field reads null at eval time, and null != "x"
# passes — so the rule saves fine and ONLY the new warning reveals the typo.
# (A typo'd rule that fails against null is blocked by the invariant gate with
# the rule's own message — also fine, but not the silent case.)
TYPO_RULE='{"max_replicaz": {"$ne": "realtime"}}'
CAP_RULE='{"max_replicas": {"$lte": 20}}'

echo "Setup: base owns min/max_replicas with a min<=max rule"
create_config "$BASE" "$(jq -n --argjson schema "$S_REPLICAS" --argjson rule "$ORDER_RULE" \
  '{schema: $schema, value: {min_replicas: 1, max_replicas: 5},
    invariants: [{name: "order", rule: $rule, message: "min must not exceed max"}]}')"
expect_no_warning_code "undeclared-rule-field" \
  "a rule over declared fields saves without the warning"

echo
echo "4b: a rule referencing an undeclared (typo'd) field warns at save"
update_config "$BASE" "$(jq -n --argjson order "$ORDER_RULE" --argjson typo "$TYPO_RULE" \
  '{invariants: [
     {name: "order", rule: $order, message: "min must not exceed max"},
     {name: "order-typo", rule: $typo, message: "typo rule"}
   ]}')"
expect_status 200 "the save is accepted (warning, not error)"
expect_warning_code "undeclared-rule-field" "…with an undeclared-rule-field warning"
if printf '%s' "$RES_BODY" | jq -r '.warnings[]?.message' | grep -qF 'max_replicaz'; then
  ok "…naming the typo'd field max_replicaz"
else
  fail "…naming the typo'd field max_replicaz"
fi

update_config "$BASE" "$(jq -n --argjson order "$ORDER_RULE" \
  '{invariants: [{name: "order", rule: $order, message: "min must not exceed max"}]}')"
expect_status 200 "cleanup: back to just the good rule"

echo
echo "Removing a field a descendant's rule references gates the publish"
create_config "$CHILD" "$(jq -n --arg parent "$BASE" --argjson cap "$CAP_RULE" \
  '{parent: $parent, value: {max_replicas: 10},
    invariants: [{name: "cap", rule: $cap, message: "capped at 20"}]}')"
expect_no_warning_code "undeclared-rule-field" \
  "child rule over an inherited declared field saves clean"

update_config "$BASE" "$(jq -n --argjson schema "$S_MIN_ONLY" '{schema: $schema}')"
expect_soft_gate 'validation rule "cap" references removed field(s) "max_replicas"' \
  "removing max_replicas → 422 naming the child's rule"
if res_message | grep -qF 'overrides removed field(s) "max_replicas"'; then
  ok "…and the child's orphaned override, in the same warning"
else
  fail "…and the child's orphaned override, in the same warning"
fi

update_config "$BASE" "$(jq -n --argjson schema "$S_MIN_ONLY" '{schema: $schema}')" \
  "?ignoreWarnings=true"
expect_status 200 "bypassed removal → 200"
expect_warning_code "undeclared-rule-field" \
  "…but the response warns the base's own kept rule now references an undeclared field"

echo
echo "Control: rules stay protective over orphaned values (unchanged behavior)"
update_config "$CHILD" '{"value": {"max_replicas": 0}}'
if [ "$RES_STATUS" != "200" ] && res_message | grep -qF "min must not exceed max"; then
  ok "a violating child publish is still rejected by the base rule after the removal"
else
  fail "a violating child publish is still rejected by the base rule after the removal"
fi

update_config "$CHILD" '{"value": {"max_replicas": 30}}'
if [ "$RES_STATUS" != "200" ] && res_message | grep -qF "capped at 20"; then
  ok "…and by the child's own rule (30 > cap of 20)"
else
  fail "…and by the child's own rule (30 > cap of 20)"
fi

summary
