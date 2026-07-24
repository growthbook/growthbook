---
name: experiment-stop
description: Stop a running GrowthBook experiment via the REST API, optionally declaring a winning variation and rolling it out to 100% of eligible traffic. Use when the user says "stop this experiment", "end the A/B test", "declare a winner for X", "ship the winning variation", "roll back the test", or "we're done with this experiment". For interpreting results before deciding, use experiment-analyze first.
---

# experiment-stop

Stop a running experiment, optionally declaring a winning variation and ramping it to all eligible traffic via a temporary rollout. The endpoint is `POST /api/v1/experiments/<id>/stop` (a dedicated endpoint, not the generic update). All variation references are **variation ID strings** like `var_abc123`, not 0-based integer indexes.

Use the `callApi` tool for every REST request. Mutating calls are gated automatically — issue `callApi` directly; do not use `askUser` for mutation confirmation.

## Workflow

1. **Fetch the current experiment.**

   ```json
   { "method": "GET", "path": "/api/v1/experiments/<experiment-id>" }
   ```

   If the user gave a name instead of an ID ("stop the checkout test"), resolve it first — `q` matches against name, tracking key, description, and hypothesis, and `status=running` keeps the candidates to experiments this skill can act on:

   ```json
   {
     "method": "GET",
     "path": "/api/v1/experiments",
     "query": { "q": "checkout", "status": "running" }
   }
   ```

   If more than one experiment plausibly matches, list the candidates and let the user pick — don't guess. Stopping the wrong experiment is not cleanly reversible.

   Check the `status` field. Only `running` experiments should be stopped via this skill. If `status === "draft"`, the experiment hasn't started — the user wants to delete it, not stop it (different operation). If `status === "stopped"`, it's already done.

   Also capture the `type` field. If `type === "multi-armed-bandit"`, halt and tell the user this skill targets standard A/B tests; bandits have their own lifecycle (stop is similar but interpretation and rollout differ — recommend they review in the UI before scripting).

2. **Show the user the variations table.** Surface the variations as the API records them — capture each one's `variationId` (the string ID, e.g. `var_treatment_a`) and `name`. The user picks **by the variation ID string**, not by index:

   ```
   The experiment has these variations:
     var_control      0: Control       — <description>  (lift: baseline, users: N)
     var_treatment_a  1: Treatment A   — <description>  (lift: +2.3%, users: N)
     var_treatment_b  2: Treatment B   — <description>  (lift: -0.8%, users: N)

   Which variation should ship? Reply with the variation ID (e.g. var_treatment_a),
   or say "no winner" to stop without declaring.
   ```

   If the user has not already run `experiment-analyze`, suggest doing that first so the decision is informed.

3. **Decide on temporary rollout.** If the user has a winner and wants to ship now, offer the temporary-rollout path:

   > "Want me to also enable a temporary rollout? That keeps this experiment in the SDK payload and forces 100% of eligible traffic to `<winnerVariationId>`. It's the cleanest 'ship the winner' option — the linked feature flag's rule stays in place but routes everyone to the winner. You can toggle it off later with `modify-temporary-rollout` or clean up the rule via `flag-targeting`."

   If yes, set `enableTemporaryRollout: true` and `releasedVariationId: <winner ID>` in the payload. If no, the experiment stops but you leave the flag alone — surface that the user will need to clean up the `experiment-ref` rule manually.

4. **Confirm intent.** Restate the action in plain English:

   > "Stopping experiment '<name>', declaring variation `var_treatment_a` (Treatment A) as the winner, and enabling temporary rollout to ship it to 100% of eligible traffic."

   Stopping itself is reversible (you can restart), but declaring a winner and enabling a rollout produces downstream signals — make sure the decision is informed, not a hunch.

5. **Build the payload.** The body is **flat**; there is no nested `resultSummary`.

   Stop without a declared winner:

   ```json
   { "results": "inconclusive" }
   ```

   Stop with a declared winner, no rollout:

   ```json
   {
     "results": "won",
     "winnerVariationId": "<winner variation ID>",
     "analysis": "<one-paragraph markdown summary of the decision>"
   }
   ```

   Stop with a declared winner and ship via temporary rollout:

   ```json
   {
     "results": "won",
     "winnerVariationId": "<winner variation ID>",
     "releasedVariationId": "<winner variation ID>",
     "enableTemporaryRollout": true,
     "analysis": "<one-paragraph markdown summary of the decision>"
   }
   ```

   Field reference:
   - `results` — required. One of `"won"`, `"lost"`, `"inconclusive"`, `"dnf"` (did not finish).
   - `winnerVariationId` — string variation ID (e.g. `var_abc123`). Required when `results === "won"` and the experiment has multiple test variations.
   - `releasedVariationId` — string variation ID. Required when `enableTemporaryRollout: true`. Usually equals `winnerVariationId`.
   - `enableTemporaryRollout` — boolean. Keeps the stopped experiment in the SDK payload and forces traffic to the `releasedVariationId`.
   - `analysis` — markdown summary shown on the experiment results page.
   - `reason` — optional reason text stored on the latest phase metadata.
   - `dateEnded` — optional ISO datetime; defaults to now.

6. **Post the update.**

   ```json
   {
     "method": "POST",
     "path": "/api/v1/experiments/<experiment-id>/stop",
     "body": { "<payload-fields>": "..." }
   }
   ```

7. **State what happens next, and link to the experiment.** Tell the user:
   - The experiment is now stopped; no more traffic accumulates against the experiment.
   - If a winner was declared, the variation ID that "won."
   - **Direct UI link** so they can verify the stopped state, the recorded `analysis`, and the rollout status: `/experiment/<experiment-id>`.

   **What happens to the flag?** Surface the disposition clearly based on what was sent:

   **With temporary rollout (`enableTemporaryRollout: true`):** the winner is live — traffic is already routed to it via the existing experiment-ref rule. No further action required until the team decides to clean up the flag (which can happen days or weeks later). When ready:
   - **Convert to permanent rule:** remove the experiment-ref rule via `flag-rules`, add a permanent force rule for the winner via `flag-targeting`.
   - **Clean up entirely:** if the feature will be inlined in code, use `flag-cleanup` to archive/delete the flag.
   - **Roll back:** turn off the temporary rollout first (POST `/api/v1/experiments/<experiment-id>/modify-temporary-rollout` with body `{ "enableTemporaryRollout": false }`), then remove the experiment-ref rule via `flag-rules`.

   **Without temporary rollout:** the experiment-ref rule is still on the flag, routing traffic to a stopped experiment (users will get the control value). The flag needs attention:
   - **Option A — Ship the winner:** set `defaultValue` to the winner's value via `flag-default-value`, then remove the experiment-ref rule via `flag-rules`. Or use `flag-targeting` to add a permanent force rule serving the winner, then remove the experiment-ref rule.
   - **Option B — Roll back:** the flag's default value already serves the control — just remove the experiment-ref rule via `flag-rules` and the flag returns to its pre-experiment state.
   - **Option C — Full cleanup:** use `flag-cleanup` to inline the value in code and archive/delete the flag.

## Guardrails

- **`winnerVariationId` is a variation ID _string_ (e.g. `var_abc123`), not an integer index, not a name, not the variation's `key`.** Get this wrong and the request 400s or the wrong variation is recorded as the winner.
- **The endpoint is `POST /api/v1/experiments/<id>/stop`, not `POST /api/v1/experiments/<id>`.** The body shape is flat — there is no `resultSummary` wrapper. The generic update endpoint exists but takes different fields; use the dedicated stop endpoint here.
- **Never declare a winner the user didn't pick.** Even if the results look obvious, force the user to choose the variation ID. Surface results, but don't pre-fill. _Skill convention, not GrowthBook policy: the API accepts any variation ID as `winnerVariationId`; the safety is enforced here, not server-side._
- **Don't stop drafts.** A `draft` experiment isn't running — what the user wants there is `DELETE /api/v1/experiments/<id>` (separate operation, not covered here). Surface the confusion if they ask to stop a draft.
- **Don't stop already-stopped experiments.** The API may accept the call but it's effectively a no-op; tell the user it's already done. To change the results metadata on an already-stopped experiment, post again with the new `results` / `winnerVariationId` / `analysis`.
- **Bandits are out of scope.** `type === "multi-armed-bandit"` experiments need different handling — halt and tell the user.
- **`releasedVariationId` is required when `enableTemporaryRollout: true`.** The API rejects the combination otherwise. They're usually the same as `winnerVariationId` but don't have to be — e.g., a "lost" result that rolls everyone back to control would set `releasedVariationId: <control variation ID>` with `results: "lost"`.
- **Always remind about the linked flag.** Stopping the experiment does not remove the `experiment-ref` rule from the linked flag. Without a temporary rollout, the flag keeps routing to a stale experiment until the user cleans the rule up.
- **`analysis` should explain the decision in plain English (markdown).** Future readers (including future-self) will want context. Don't leave it blank when declaring a winner.
- **Run `experiment-analyze` first if the user hasn't.** Stopping based on a glance at the dashboard is a common mistake — interim numbers can flip, and the data-quality checks in `experiment-analyze` can flag results that look conclusive but aren't.
- **`q` rejects negation and operators with a 400.** The list endpoint's `q` param takes the app's search syntax (`status:running tag:checkout` plus free text) but hard-rejects `!`, `~`, `^`, `>`, `<`, `=`. Send plain `field:value` tokens and free text only.

## Endpoints used

- `GET /api/v1/experiments?q=<text>&status=running` — resolve an experiment ID when the user only gave a name or keyword. `q` matches name, tracking key, description, and hypothesis.
- `GET /api/v1/experiments/<id>` — fetch state, variations, and `type`
- `POST /api/v1/experiments/<id>/stop` — stop and optionally declare a winner + temporary rollout
- `POST /api/v1/experiments/<id>/modify-temporary-rollout` — toggle the temporary rollout off (or on) after stopping, without re-running this skill

## Handoffs

- `loadSkill('experiment-analyze')` — run first if the user wants to interpret results before deciding.
- `loadSkill('flag-rules')` — remove the experiment-ref rule after stopping (always needed eventually).
- `loadSkill('flag-targeting')` — add a permanent force rule serving the winner value (replaces the experiment-ref rule).
- `loadSkill('flag-default-value')` — set the flag's default to the winner value when shipping without a targeting rule.
- `loadSkill('flag-cleanup')` — if the feature is fully shipped and the flag should be removed from code and archived.
- `loadSkill('experiment-design')` and `loadSkill('experiment-launch')` — for the next test if this one informed a follow-up.
