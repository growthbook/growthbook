---
name: experiment-analyze
description: Fetch results for a GrowthBook experiment, refresh the snapshot only when the cached data is over 24 hours old, then interpret. Use when the user asks "what are the results of X", "analyze this experiment", "is X winning", "did the test work", "show me the results", or "dig into the dimensions". Reads only — does not stop or modify the experiment. For stopping after you've seen results, use experiment-stop.
---

# experiment-analyze

Fetch results, refresh the snapshot only when the cached data is over 24 hours old or the user wants a different phase/dimension cut, then interpret. The statistical interpretation is the heart of this skill — slow down and do each step deliberately.

Use the `callApi` tool for every REST request. This skill is read-only — it never stops or modifies the experiment.

## Workflow

1. **Fetch results + experiment metadata in one call.** `/results` returns `{ experiment, result }` — the same payload that powers the GrowthBook UI's results view, so there's no need for a separate metadata call.

   ```json
   { "method": "GET", "path": "/api/v1/experiments/<experiment-id>/results" }
   ```

   ```json
   {
     "method": "GET",
     "path": "/api/v1/experiments/<experiment-id>/results",
     "query": { "phase": "1", "dimension": "exp:country" }
   }
   ```

   The `phase` and `dimension` query params filter to the latest snapshot taken with those settings; omit both for the default "how is it doing" view.

   From `experiment`, capture:
   - `status` — `running` or `stopped` both make sense for analysis. If `draft`, there are no results to interpret; tell the user.
   - `type` — if `"multi-armed-bandit"`, halt and tell the user this skill targets standard A/B tests. Bandits report differently (per-arm probabilities, dynamic traffic allocation) and shouldn't be read with the standard winner/loser framing.
   - `settings.statsEngine` — `"bayesian"` (default) or `"frequentist"`. Drives the metric-interpretation step below.
   - `regressionAdjustmentEnabled` (CUPED) and `sequentialTestingEnabled` — affect what to report.

   From `result`, capture:
   - `id` — the snapshot ID.
   - `dateUpdated` — ISO timestamp of when this snapshot was created. Drives the staleness check in step 2.
   - The per-variation metric data itself (lift estimates, intervals, sample sizes) — what step 4 interprets.

   If the response errors with `"No results found for that experiment"`, the experiment has been started but no snapshot exists yet (the auto-refresh hasn't run, or you've filtered to a phase/dimension that's never been snapshotted). Skip step 2 and jump straight to step 3.

2. **Decide whether to refresh.** Branch on `result.dateUpdated`:
   - **Under 24 hours old, and the existing snapshot matches the user's requested phase/dimension** → skip step 3, jump to step 4.
   - **Over 24 hours old, or the user explicitly asked for a fresh snapshot** → step 3.

   The server auto-refreshes snapshots every 6 hours by default (`EXPERIMENT_REFRESH_FREQUENCY`), so anything under 24 hours has typically been refreshed at least once recently. The 24-hour bar is deliberately conservative — don't burn snapshot-compute budget on data that hasn't moved.

3. **Trigger a fresh snapshot, then re-fetch results.**

   **3a. POST a snapshot** (not gated — runs immediately). Optional body fields shape what gets computed; pass the same `phase` / `dimension` the user asked for in step 1:
   - `phase` (integer, 0-indexed): pick a specific phase if the experiment has multiple. Defaults to the latest phase.
   - `dimension` (string): break the results down. Built-in: `"pre:date"`, `"pre:activation"`. For a configured Unit Dimension, use its ID (e.g. `"dim_abc123"`). For an Experiment Dimension, prefix with `"exp:"` (e.g. `"exp:country"`).

   ```json
   {
     "method": "POST",
     "path": "/api/v1/experiments/<experiment-id>/snapshot",
     "body": {}
   }
   ```

   ```json
   {
     "method": "POST",
     "path": "/api/v1/experiments/<experiment-id>/snapshot",
     "body": { "phase": 1, "dimension": "exp:country" }
   }
   ```

   The response is `{ snapshot: { id, experiment, status } }`. Capture `snapshot.id`.

   **3b. Do not poll in a tight loop.** Call `GET /api/v1/snapshots/<snapshot-id>` once:

   ```json
   { "method": "GET", "path": "/api/v1/snapshots/<snapshot-id>" }
   ```

   If `status` is `success`, continue to 3c. If it's still `running`, tell the user analysis is in progress and they can ask again in a few minutes — don't block on a loop.

   **3c. Re-fetch results** with the same phase/dimension args used in 3a, then re-capture the fields listed in step 1:

   ```json
   {
     "method": "GET",
     "path": "/api/v1/experiments/<experiment-id>/results",
     "query": { "phase": "1", "dimension": "exp:country" }
   }
   ```

4. **Run the data-quality checks first, then interpret.** GrowthBook surfaces six health checks; any failing one changes how the result should be read. Surface failures prominently — don't bury them.

   **Data-quality checks (in order):**
   - **SRM (Sample Ratio Mismatch).** Observed traffic split vs. configured split. Failure invalidates downstream results — say so prominently and stop interpreting until the user understands the bias risk. Common causes: bot traffic, ad-blockers blocking client-side tracking, mid-experiment targeting changes, activation-metric bias.
   - **Multiple Exposures.** Users assigned to more than one variation. A small rate (<1%) is usually fine; a high rate suggests sticky bucketing isn't configured or the hash attribute isn't stable.
   - **Minimum Data Thresholds.** Per-metric minimums (configured per metric). If a metric is below its threshold, results for that metric are not trustworthy yet.
   - **Variation ID Mismatch.** Variation IDs reported by exposures don't match the experiment's configured variations. Indicates a tracking/configuration bug.
   - **Suspicious Uplift.** Per-metric lift exceeds configured suspicious thresholds. Doesn't mean the result is wrong, but real lifts that large are rare — usually a tracking or metric-definition issue.
   - **Guardrails.** Listed under data-quality in the docs because a failing guardrail is a hard stop on shipping. For each: any regression? Even a non-significant regression on a guardrail is worth flagging. Note: multiple-comparison correction is **not** applied to guardrails by design.

   **Power check.** Is the experiment at or near the expected sample size? If well under (e.g., <50% of planned), warn that conclusions are speculative — especially on the frequentist engine, where peeking inflates false-positive rates more aggressively. Bayesian results are more robust to peeking but still benefit from the planned sample size.

   **Primary metric — branch on stats engine:**
   - **Bayesian (`settings.statsEngine === "bayesian"`, the default):** Report **Chance to Win** (the probability the treatment beats the control given the data and prior) and the relative-uplift distribution (point estimate + Credible Interval). GrowthBook treats >95% Chance to Win as a strong positive signal; <5% as a strong negative; the rest is inconclusive. Don't fabricate a p-value.
   - **Frequentist (`settings.statsEngine === "frequentist"`):** Report the lift point estimate, 95% confidence interval, and whether the CI crosses zero. If `regressionAdjustmentEnabled` is true (CUPED), point-estimates may differ from raw means; CIs are typically narrower. If `sequentialTestingEnabled` is true, CIs are intentionally wider to make peeking safe — call this out so the user doesn't compare them to non-sequential CIs.

   **Secondary metrics.** Surface but caveat — these are exploratory; multiple-comparison risk applies on the frequentist engine (GrowthBook only applies the correction there; on Bayesian, the implicit correction comes from the prior). Don't promote a secondary to "we won on X" if the primary didn't move.

   **Dimensions (if user asks).** If the snapshot was taken with a `dimension`, the results endpoint returns the per-dimension cuts. Surface notable splits but don't fish — dimensional analysis multiplies the comparison count.

5. **Present the result.** Use this shape (skip rows that don't apply):

   ```
   ## Experiment: <name> (<id>)
   - Status: <running|stopped>
   - Type: <standard|multi-armed-bandit>
   - Stats engine: <bayesian|frequentist>
   - Adjustments: <CUPED on/off, sequential testing on/off>
   - Phase: <phase name or index>
   - Dimension: <none | dimension id used>
   - Sample size: <total users> across N variations
   - Snapshot timestamp: <when this snapshot ran>

   ### Data-quality checks
   - SRM: <pass / fail with detail>
   - Multiple Exposures: <pass / rate>
   - Minimum Data Thresholds: <met / not met, per metric>
   - Variation ID Mismatch: <pass / fail>
   - Suspicious Uplift: <none / per-metric flags>

   ### Primary metric: <name>
   - Variation 0 (Control): <baseline value>
   - Variation 1 (Treatment): <value>
   - **Bayesian:** Chance to Win <X%>, relative lift <±Y%>, 95% CrI [a, b]
   - **Frequentist:** lift <±Y%>, 95% CI [a, b]<note if CIs are sequential>
   - Verdict: <won / lost / inconclusive>

   ### Guardrails
   - <metric>: <safe / regressed by Y%>

   ### Secondary metrics
   - <metric>: <lift / no movement> <multiple-comparison caveat if frequentist>

   ### Recommendation
   <one paragraph: ship, kill, extend, or investigate>
   ```

6. **Link to the experiment, then suggest the next step.** Surface the direct UI link so the user can review the live results, dimensional cuts, and historical snapshots beyond what `/results` returns:

   ```
   View in GrowthBook: /experiment/<exp_id>
   ```

   Then suggest a next action based on `experiment.status` from step 1:
   - `running` and conclusive → suggest `loadSkill('experiment-stop')` with the chosen variation.
   - `running` and inconclusive → suggest waiting or extending.
   - `stopped` → point at flag cleanup via `loadSkill('flag-targeting')` to update or remove the `experiment-ref` rule on the linked flag.

## Guardrails

- **All six data-quality checks come before interpretation.** SRM, Multiple Exposures, Minimum Data Thresholds, Variation ID Mismatch, Suspicious Uplift, and Guardrails. A failure in any of them changes how (or whether) to interpret the result. Don't bury them under the primary-metric heading.
- **Branch interpretation on `settings.statsEngine`.** Bayesian (default) reports Chance to Win + Credible Intervals; frequentist reports lift + Confidence Intervals. Don't manufacture a p-value the API didn't return, and don't claim "95% CI" on a Bayesian result (it's a Credible Interval, not a Confidence Interval).
- **Multiple-comparison correction is frequentist-only and excludes guardrails.** When reporting secondaries, note the correction status. On Bayesian, the prior provides implicit shrinkage; no correction is applied.
- **CUPED and sequential testing change how to read CIs.** If `regressionAdjustmentEnabled` is true, point estimates may differ from raw means and CIs are typically narrower. If `sequentialTestingEnabled` is true, CIs are intentionally wider — say so, so the user doesn't compare them apples-to-oranges with non-sequential results.
- **Don't peek-and-decide.** Under-powered experiments mean interim numbers are noisy. Frequentist peeking inflates false-positive rates; Bayesian is more robust but still benefits from hitting the planned sample size.
- **Bandits are out of scope.** `type === "multi-armed-bandit"` reports per-arm probabilities and dynamically reallocates traffic. Halt and tell the user to read bandit results in the UI.
- **Activation-metric bias hides as "passing SRM."** If the experiment uses an activation metric that is downstream of variation differences (e.g., "completed signup" when variations affect signup completion), the overall split can look fine while the activated cohort is biased. The dashboard surfaces this; flag it when you spot the pattern in metadata.
- **Don't promote a secondary to a primary.** If the primary didn't move, the experiment didn't move — secondaries are exploratory.
- **Don't poll snapshots in a tight loop.** Trigger a snapshot, check its status once, and if it's still running tell the user to ask again later. A busy org against the 60 rpm limit doesn't need a polling skill hammering it.
- **Snapshot timestamp matters.** Always surface `result.dateUpdated` when reporting results — it's both how step 2 decides whether to refresh and how the user judges whether a slow-traffic experiment has moved. Stale snapshots are common; don't hide them.
- **24h is a deliberate ceiling, not the auto-refresh cadence.** The server auto-refreshes every 6h by default, so a snapshot under 24h has almost always been refreshed at least once. Don't drop it to "any data older than a minute" — that's how you pin a busy org against the 60 rpm limit.
- **Read-only.** This skill never stops or modifies the experiment. Hand off to `experiment-stop` when the user wants to act.

## Endpoints used

- `GET /api/v1/experiments/<id>/results` — primary entry point; returns `{ experiment, result }` so step 1 grabs metadata, status, and the snapshot timestamp (`result.dateUpdated`) in a single call. Accepts `phase` / `dimension` query params.
- `POST /api/v1/experiments/<id>/snapshot` — trigger a fresh snapshot when results are over 24h old or the user wants a phase/dimension cut the cached snapshot doesn't cover. Body accepts `phase` (integer) and `dimension` (string).
- `GET /api/v1/snapshots/<snapshot-id>` — check snapshot completion (one call, not a poll loop). Returns `{ snapshot: { id, experiment, status } }`.

## Handoffs

- `loadSkill('experiment-stop')` — when the user is ready to act on a conclusive result.
- `loadSkill('flag-targeting')` — after stopping with a winner, the linked flag (if any) needs its `experiment-ref` rule updated or removed.
- `loadSkill('experiment-brainstorm')` — to ground ideas for the next test in results from past experiments.
