#!/usr/bin/env bash
# Replies to every Greptile thread on growthbook/growthbook#7638, posts a
# summary comment, and (with --resolve) resolves the round-1 threads.
# Run from a machine where `gh auth status` succeeds:
#   bash "Claude outputs/reply-greptile-7638.sh"            # dry run: prints what it would post
#   bash "Claude outputs/reply-greptile-7638.sh" --post     # post replies + summary
#   bash "Claude outputs/reply-greptile-7638.sh" --post --resolve
set -euo pipefail
REPO=growthbook/growthbook
PR=7638
POST=false; RESOLVE=false
for a in "$@"; do case "$a" in --post) POST=true;; --resolve) RESOLVE=true;; esac; done

reply() { # id, body
  local id="$1" body="$2"
  if $POST; then
    gh api "repos/$REPO/pulls/$PR/comments/$id/replies" -f body="$body" --silent && echo "replied to $id"
  else
    echo "--- would reply to $id:"; echo "$body"; echo
  fi
}

# ---------- round 1 (reviewed at 93675dc) ----------
reply 4498946179 'Fixed in `ef583ca`. `deleteByExperiment` now loads the experiment into foreign refs before the per-row permission check. Lifecycle cleanup (start / archive / delete) uses a separate `deleteByExperimentForLifecycle` that skips the check, since the actor already changed the experiment and it may be gone. `39fdbc6` additionally checks every row before deleting any (see the newer thread).'
reply 4498946189 'Fixed in `ef583ca`. Connection summaries are filtered with `canReadMultiProjectResource` before they are returned.'
reply 4498946199 'Fixed in `f44a9a2`. `getFeatureDefinitionsWithCache` derives the connection id from either param shape, so the `proxyUpdate` and `sdkWebhooks` cache-miss builds include overrides.'
reply 4498946208 'Fixed in `f44a9a2`. Override filters are a new `qaOverrides` source for `getSavedGroupIdsForFeatureDefinitions`, and overrides are loaded before the group map in both the bulk refresh and the cold build.'
reply 4498946222 'Fixed in `f44a9a2`. The QA copy is emitted with `status: "running"`; the stored experiment stays a draft.'
reply 4498946234 'Fixed in `f44a9a2`. Forcing a variation now deletes `rule.filters` as well as `rule.namespace`.'
reply 4498946246 'Fixed in `c96c64e`. Permissions are checked per row against that override'"'"'s environment, and "Add" shows when any eligible environment is allowed.'
reply 4498946253 'Adjusted in `ef583ca`: the guard applies to dashboard writes only, so the REST API keeps accepting any `trackingKey` and existing integrations are unaffected. The app'"'"'s key generator only emits `[a-z0-9_-]`, so the dashboard guard just stops a hand-typed key from colliding with QA exposure data. We kept the past-experiments discovery filter deliberately: a warehouse key that literally ends in `::qa` is far more likely to be QA data than a customer key, and the only effect is that it is not offered for import. Happy to drop that too if we would rather be strictly additive there.'
reply 4498946263 'Fixed in `ef583ca`. The cleanup moved into `cleanupDeletedEnvironment`, which both the dashboard and REST handlers call.'
reply 4498946273 'Fixed in `f44a9a2`, and it was two gates rather than one: the feature-level check at the top of `getFeatureDefinition` and the per-rule one. Both now treat a draft whose overrides all force a variation as un-gated; a random override still needs the prerequisites, so that case keeps the live behaviour (feature excluded on an SDK without the capability).'
reply 4498946282 'Fixed in `f44a9a2`. Both paths now match project filters against the effective (environment-filtered) project list, since that is what the connection actually serves.'
reply 4498946288 'Adjusted in `f44a9a2`. The holdout rule stays and its condition is ANDed with `$not` of the QA rules'"'"' conditions, so only requests an override actually matches skip the holdout; everyone else keeps it. It is dropped only when an override has no filters and matches everyone. We did not move QA rules above the holdout because that would also jump the prerequisite gates and any rules above the experiment rule, which the team decided to leave in place.'
reply 4498946294 'Fixed in `ef583ca`. The list must have the same length as the existing overrides, no duplicates, and no unknown ids.'
reply 4498946299 'Fixed in `c96c64e`. Both sections render the hook'"'"'s `error`, and remove / reorder actions surface their failures.'
reply 4498946307 'Fixed in `c96c64e`. The decision is `canPublishEnvironmentToggle` in `shared/permissions/controlAuthority`, with tests for reviews off / on, environment subsets, the environment-toggle exemption, bypass, and missing permissions. It mirrors `KillSwitchModal`; moving that modal onto the helper is a reasonable follow-up.'
reply 4498946312 'Fixed in `c96c64e`.'
reply 4498946316 'Fixed in `f44a9a2`: `qaOverridesForConnection` is covered for production and unknown environments, connection and project filters, a connection scrubbed to no projects, and ordering.'
reply 4498946326 'Addressed in `f44a9a2` by making it true: each visual / redirect copy excludes requests earlier overrides cover, refined in `39fdbc6` so only copies that serve everyone they match can block later ones.'

# ---------- round 2 (reviewed at cf35f09) ----------
reply 4518341622 'Fixed in `39fdbc6`. The chain now only excludes by copies that serve everyone their condition matches: forced overrides, or random ones at 100% coverage with no namespace. A random copy with partial coverage or a namespace no longer blocks the overrides after it (users outside its coverage fall through to the next one, as with a Feature Flag rule), and a copy that builds to `null` never blocks. Two overlapping partial-coverage random copies can both apply to a visual draft; that matches how the SDK runs visual experiments and is acceptable for a non-production tool — noted in the code. Tests cover the fall-through case and a full-coverage copy still blocking.'
reply 4518341642 'Fixed in `39fdbc6` and `6028da7`. `deleteByExperiment` checks every row'"'"'s permission before deleting any, so a forbidden row throws up front and nothing is half-deleted or left unrefreshed. "Remove all" is only offered when every override is editable, and per-row Remove now confirms first.'
reply 4518341659 'Added in `39fdbc6`: `shared/test/qa-overrides.test.ts` covers a live rule, `draft` / `discarded` / `archived` rule states, `disabled-env`, `disabled-rule` and `missing` environment states, and that only the override'"'"'s own environment is consulted; plus the filter helpers.'

# ---------- summary comment ----------
SUMMARY='Both review rounds are addressed in `f44a9a2`…`6028da7` (each thread names its commit). Two decisions worth a look rather than a rubber stamp:
- **`::qa` tracking-key guard:** kept for dashboard writes only; the REST API accepts any key. The past-experiments discovery filter still hides warehouse keys ending in `::qa` — happy to drop that if we would rather be strictly additive there too.
- **Holdouts:** the holdout rule stays and excludes only requests a QA override actually matches, rather than being dropped for the whole feature or having QA rules jump above the prerequisite gates.

Still to do before this is mergeable: a browser pass of the filter builder, reorder and both "Enable" paths, plus a visual-editor draft (that path only started executing in `f44a9a2`).'
if $POST; then gh pr comment "$PR" --repo "$REPO" --body "$SUMMARY" && echo "posted summary"; else echo "--- would post summary:"; echo "$SUMMARY"; fi

# ---------- resolve the round-1 threads ----------
if $RESOLVE && $POST; then
  ROUND1="4498946179 4498946189 4498946199 4498946208 4498946222 4498946234 4498946246 4498946253 4498946263 4498946273 4498946282 4498946288 4498946294 4498946299 4498946307 4498946312 4498946316 4498946326"
  gh api graphql -f query='query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId}}}}}}}' \
    -f owner=growthbook -f name=growthbook -F pr=$PR --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not) | "\(.id) \(.comments.nodes[0].databaseId)"' |
  while read -r tid cid; do
    if [[ " $ROUND1 " == *" $cid "* ]]; then
      gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id="$tid" --silent && echo "resolved thread for comment $cid"
    fi
  done
fi
