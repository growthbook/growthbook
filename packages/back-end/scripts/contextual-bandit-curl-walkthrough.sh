#!/usr/bin/env bash
# §6.8-style contextual bandit walkthrough via REST API v1.
# Requires: curl, jq
# Env:
#   GROWTHBOOK_API_KEY — organization Secret API key (Settings → API Keys)
#   CBAQ_DATASOURCE_ID — datasource id (e.g. ds_...)
#   CBAQ_METRIC_ID     — goal metric id (e.g. met_...)
# Optional:
#   BASE_URL (default http://127.0.0.1:3100/api/v1)
#   CBAQ_ASSIGNMENT_QUERY_ID — exposure/assignment identifier type id (default user_id)
#
# Note: There is no GET /api/v1/jobs/:id. refresh-top-values returns a synthetic
# jobId; wait by re-GETting the CBAQ until string attributes have topValues.
#
# Event webhooks live on the authenticated app (JWT), not api/v1 — create those
# from the UI or POST /event-webhooks with a session cookie; step 5 is skipped here.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3100/api/v1}"
ASSIGNMENT_ID="${CBAQ_ASSIGNMENT_QUERY_ID:-user_id}"

: "${GROWTHBOOK_API_KEY:?Set GROWTHBOOK_API_KEY}"
: "${CBAQ_DATASOURCE_ID:?Set CBAQ_DATASOURCE_ID}"
: "${CBAQ_METRIC_ID:?Set CBAQ_METRIC_ID}"

AUTH=( -H "Authorization: Bearer ${GROWTHBOOK_API_KEY}" -H "Content-Type: application/json" )

TRACKING_KEY="cb-walkthrough-$(date +%s)"

echo "== 1. Create CBAQ =="
CBAQ_PAYLOAD=$(
  jq -n \
    --arg ds "$CBAQ_DATASOURCE_ID" \
    --arg aid "$ASSIGNMENT_ID" \
    '{
      datasourceId: $ds,
      name: ("curl-cbaq-" + (now|tostring)),
      identifierType: $aid,
      sql: "SELECT user_id, variation_id AS variation, country, device FROM cb_assignments",
      attributes: [
        {name: "country", column: "country", datatype: "string"},
        {name: "device", column: "device", datatype: "string"}
      ]
    }'
)

CBAQ_JSON=$(curl -sS "${BASE_URL}/contextual-bandit-queries" "${AUTH[@]}" -d "$CBAQ_PAYLOAD")
echo "$CBAQ_JSON" | jq .
CBAQ_ID=$(echo "$CBAQ_JSON" | jq -er '.contextualBanditQuery.id')
echo "CBAQ_ID=$CBAQ_ID"

echo "== 2. Test CBAQ =="
curl -sS "${BASE_URL}/contextual-bandit-queries/${CBAQ_ID}/test" "${AUTH[@]}" -d '{}' | jq -e '.ok == true' >/dev/null

echo "== 3. Refresh top values (queue) + poll CBAQ =="
curl -sS -X POST "${BASE_URL}/contextual-bandit-queries/${CBAQ_ID}/refresh-top-values" "${AUTH[@]}" | jq .

for _ in $(seq 1 36); do
  TOP=$(curl -sS "${BASE_URL}/contextual-bandit-queries/${CBAQ_ID}" "${AUTH[@]}")
  READY=$(echo "$TOP" | jq '[.contextualBanditQuery.attributes[] | select(.datatype == "string" and (.deleted | not)) | (.topValues | length > 0)] | all')
  if [[ "$READY" == "true" ]]; then
    echo "Top values populated."
    break
  fi
  sleep 5
done

echo "== 4. Create experiment =="
EXP_PAYLOAD=$(
  jq -n \
    --arg ds "$CBAQ_DATASOURCE_ID" \
    --arg aq "$ASSIGNMENT_ID" \
    --arg tk "$TRACKING_KEY" \
    --arg mid "$CBAQ_METRIC_ID" \
    --arg cbaq "$CBAQ_ID" \
    '{
      datasourceId: $ds,
      assignmentQueryId: $aq,
      trackingKey: $tk,
      name: "CB curl walkthrough",
      disableStickyBucketing: true,
      metrics: [$mid],
      variations: [
        {key: "control", name: "Control"},
        {key: "promo_a", name: "Promo A"},
        {key: "promo_b", name: "Promo B"}
      ],
      isContextualBandit: true,
      cbaqId: $cbaq,
      contextualBanditConfig: {
        contextualAttributes: ["country", "device"],
        maxContexts: 12,
        treeModel: "regression_tree",
        minUsersPerLeaf: 100,
        holdoutPercent: 0,
        stickyBucketing: false
      }
    }'
)

EXP_JSON=$(curl -sS "${BASE_URL}/experiments" "${AUTH[@]}" -d "$EXP_PAYLOAD")
echo "$EXP_JSON" | jq .
EXP_ID=$(echo "$EXP_JSON" | jq -er '.experiment.id')
echo "EXP_ID=$EXP_ID"

echo "== 5. Webhook subscription skipped (use UI or POST /event-webhooks with JWT on APP_ORIGIN) =="

echo "== 6. Contextual bandit refresh =="
curl -sS -X POST "${BASE_URL}/experiments/${EXP_ID}/contextual-bandit/refresh" "${AUTH[@]}" -d '{}' | jq .

echo "== 7. Wait + read current tree leaves =="
sleep 30
curl -sS "${BASE_URL}/experiments/${EXP_ID}/contextual-bandit/current" "${AUTH[@]}" | jq '(.contextualBanditEvent // {}) | .tree.leaves // [] | length'

echo "== 10. Stop experiment =="
curl -sS -X PUT "${BASE_URL}/experiments/${EXP_ID}" "${AUTH[@]}" -d '{"status":"stopped"}' | jq .
curl -sS "${BASE_URL}/experiments/${EXP_ID}" "${AUTH[@]}" | jq '.experiment.banditStage'

echo "Done."
