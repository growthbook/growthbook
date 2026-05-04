# Contextual Bandits — v1 sanity runbook

A short manual checklist a human runs once before declaring v1 done.
This intentionally lives outside CI: it covers programmatic-only
operations a real engineer must be able to perform end-to-end with
nothing but `curl`, `gh`, and a docker-compose stack.

> Source plan: `contextual-bandit-implementation-plan.md` §P7.3
> Walkthrough reference: §6.8 ten-step CI script

---

## Pre-flight

- [ ] Local stack up:
      `docker compose -f packages/back-end/docker-compose.yml up`
- [ ] `BASE_URL=http://localhost:3100/api/v1`
- [ ] `AUTH='-H "Authorization: Bearer $GROWTHBOOK_API_KEY"'`
- [ ] Org has the `contextual-bandits` commercial feature on its license
      (else every CB endpoint returns 402).

---

## §6.8 walkthrough — manual replay

### 1. Spin up a CB experiment from `curl` only (no UI)

- [ ] **Create the CBAQ.**
      ```bash
      curl -sS $BASE_URL/contextual-bandit-queries $AUTH \
        -H 'Content-Type: application/json' \
        -d @fixtures/cbaq.json
      ```
      Expect `200` and `id` matches `^cbaq_`.

- [ ] **Validate the SQL.**
      `POST /contextual-bandit-queries/:id/test` returns `{ ok: true }`
      and a `nullRate[]` summary. Anything `>5%` should be eyeballed.

- [ ] **Refresh top values.**
      `POST /contextual-bandit-queries/:id/refresh-top-values` returns
      `{ status: "running", jobId: ... }`. Re-`GET` the CBAQ after the
      Agenda job runs (≤ 30s in dev) and confirm each string attribute
      has `topValues.length > 0`.

- [ ] **Create the experiment.**
      `POST /experiments` with `isContextualBandit: true`, `cbaqId`,
      `contextualBanditConfig.contextualAttributes` matching live
      (non-deleted) CBAQ attributes, `holdoutPercent: 0`,
      `disableStickyBucketing: true`, exactly one `metrics[]`.
      Expect `200` + `id` matches `^exp_`.

      Validation matrix to spot-check by sending bad payloads:
      - [ ] `cbaqId` from a different org → `400`
      - [ ] `contextualAttributes` referencing a deleted column → `400`
      - [ ] `maxContexts × variations.length > 3000` → `400`
      - [ ] `disableStickyBucketing: false` → `400`
      - [ ] `goalMetrics.length !== 1` → `400`

- [ ] **Subscribe a webhook.**
      `POST /event-webhooks` filtering on:
      - `experiment.contextual_bandit.snapshot.completed`
      - `experiment.contextual_bandit.weights.updated`
      - `experiment.contextual_bandit.attribute_coverage_degraded`
      - `experiment.contextual_bandit.stage_transitioned`

- [ ] **Trigger a manual snapshot.**
      `POST /experiments/:id/contextual-bandit/refresh` returns `200` +
      `contextualBanditEvent.id` matches `^cbe_` and
      `weightsWereUpdated: true`.

      _Equivalent legacy route:_
      `POST /experiments/:id/snapshot { "bandit": { "reweight": true } }`
      dispatches into the same orchestrator.

### 2. After 10 minutes of synthetic traffic, weights actually change

- [ ] Drive synthetic traffic through your test harness so the CBAQ has
      coverage across at least three contexts.
- [ ] Wait one CB tick (default cadence matches MAB — see
      `runContextualBanditSnapshot.ts`).
- [ ] `GET /experiments/:id/contextual-bandit/current` and confirm:
      - `weights` differ from the previous tick for at least one context
      - `tree.leaves.length >= 1`
      - `seed` changed (orchestrator re-randomizes per tick)
- [ ] `GET /experiments/:id/contextual-bandit/contexts?contextId=...`
      shows newest-first history.

### 3. Webhook fires on weight update

- [ ] In the customer endpoint logs, confirm a single
      `experiment.contextual_bandit.weights.updated` payload arrived
      within ~5s of the snapshot, with `data.object.id` matching the new
      `cbe_*` id.
- [ ] Confirm `experiment.contextual_bandit.snapshot.completed` arrived
      regardless of whether weights were updated.

### 4. Failing the attribute presence check fails fast

- [ ] Drop a column from the CBAQ source SQL mid-experiment (or rename
      it):
      `PUT /contextual-bandit-queries/:id { "sql": "..." }`
- [ ] Trigger another snapshot:
      `POST /experiments/:id/contextual-bandit/refresh`
- [ ] Expect:
      - `200` with `contextualBanditEvent.error` populated _OR_ the
        snapshot returns a degraded result (the orchestrator should
        surface a structured error, not 500).
      - One `experiment.contextual_bandit.attribute_coverage_degraded`
        webhook fires.
      - The experiment phase's `currentLeafWeights` is **not** updated
        when the validation gate fails.

### 5. Stopping the experiment halts the schedule

- [ ] `PUT /experiments/:id { "status": "stopped" }` → `200`.
- [ ] Wait one CB tick.
- [ ] Confirm `nextSnapshotAttempt` is null (or never advanced) and no
      new `cbe_*` doc was created.
- [ ] `experiment.contextual_bandit.stage_transitioned` webhook fires
      with `previousStage`/`newStage` reflecting the stop.

---

## Post-flight

- [ ] Tear down: `docker compose down -v`
- [ ] Filed any rough-edge issues in the CB-v1.5 milestone.

## Out of scope (deferred to v1.5)

- `train_id=0` holdout flow (steps §6.8 #8 and #9 in the walkthrough).
- `LinearThompsonReducer` implementation (stub only in v1).
- Non-JS SDKs.
- Sticky bucketing (forced off).
- Any UI surfaces.
