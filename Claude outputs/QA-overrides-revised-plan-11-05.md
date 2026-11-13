# Revised plan: QA overrides after the 11/05 meetings

Date: 2026-11-05. Sources: the QA workflow meeting (Jeremy, Bryce, Luke, Michael), design sync 1 (Gabe), Teresa's meeting notes, and the current `qa_overrides_prototype` code. Where this plan and `Plans/Implementation plan - experiment QA overrides` disagree, this plan wins. Anything not mentioned here still stands.

**Updated 2026-11-06:** PR A (`isProduction` on environments) is done as [#7614](https://github.com/growthbook/growthbook/pull/7614). Section 2 now describes what shipped, and the sections that depend on it use the helpers it added.

---

## 0. What changed, in one table

| Area                                  | Before (10/21 plan / prototype)                                                                                                          | Now                                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Experiment status                     | Draft only                                                                                                                               | **Draft only** (decided 11/05). Running experiments are out of scope for v1                                                                                                                                                       |
| What an override targets              | An **SDK connection**. The prototype's unique index on `(experiment, sdkConnection)` limits an experiment to one override per connection | An **environment**, picked from a selector that is always visible. Filters (below) narrow it further                                                                                                                              |
| Narrowing                             | Identifier `is any of` only                                                                                                              | Optional **Add filter**: identifier/condition, saved group, SDK connection, project. You can add more than one                                                                                                                    |
| Environment gate                      | `qaOverridesEnabled` opt-in, production allowed                                                                                          | **Remove** `qaOverridesEnabled`. Use the general **`isProduction`** field from #7614, read through `isProductionEnvironment(env)`. QA is **blocked on production** for now                                                        |
| Experiment targeting                  | Two checkboxes (conditions, coverage)                                                                                                    | Checkboxes removed. Targeting depends on the assignment mode (below)                                                                                                                                                              |
| Random assignment                     | Targeting and coverage optional                                                                                                          | **Uses the experiment as-is**: condition, saved groups, prerequisites, coverage, namespace. **Holdouts are ignored** (decided 11/05): a tester who hashes into the holdout still gets the experiment instead of the holdout value |
| Force variation                       | Targeting and coverage optional                                                                                                          | **Drops** experiment targeting, coverage, prerequisites, namespace and holdout. Still uses one-hot weights, not `force`                                                                                                           |
| Seed                                  | `rule.seed = rule.key` (the QA key)                                                                                                      | **Leave the seed alone**: use the experiment's phase seed                                                                                                                                                                         |
| Tracking key                          | `<key>__qa`                                                                                                                              | A **more distinctive** suffix that won't collide with a real key by chance                                                                                                                                                        |
| Overrides per experiment              | Several, but at most one per connection                                                                                                  | **As many as you want**, including several in the same environment (e.g. force variation A for one tester and B for another). Each becomes its own experiment rule, and the first match wins                                      |
| Linked feature off in the environment | Warning only                                                                                                                             | The override can be created, but it **doesn't apply until the feature is on** in that environment. Add an "Enable now" button that publishes the change when no approvals are needed                                              |
| Dev tools                             | Optional `qa: true`                                                                                                                      | Add **override metadata on the rule** so dev tools can explain the override and undo it                                                                                                                                           |
| QA results                            | P2 (Jeremy)                                                                                                                              | **Punt**: just keep the data out of the main analysis                                                                                                                                                                             |

---

## 1. Delivery order

1. ~~**PR A: `isProduction` on environments.**~~ **Done: #7614.**
2. **Rebase the prototype onto main** once #7614 merges, and swap `qaOverridesEnabled` for `isProduction` (section 2 lists every reference). Do this before PR B, because the environment files will conflict.
3. **PR B: rework the QA override model and API** so overrides are scoped to an environment and take filters.
4. **PR C: payload.** N rules per experiment, what force and random keep or drop (including holdouts), the seed fix, the new key, and dev tools metadata.
5. **PR D: modal and section UI.** Waiting on Gabe's mockups, but work can start against the current layout.
6. **PR E: gating on the linked feature, plus the "Enable now" button.**
7. **PR F (optional): exposure diagnostics toggle.** Only needs updating for the new key.

---

## 2. PR A: `isProduction` on environments (done, #7614)

**What shipped**

- **Field.** `isProduction: z.boolean().optional()` on `environment` and `updateEnvValidator` (`shared/src/validators/environment.ts`).
- **Helpers** in `shared/src/util/environments.ts`, exported from `shared/util`:
  - `guessIsProductionEnvironment(id)`: returns `false` only when the ID, ignoring case, is exactly `dev`, `staging` or `test`. Everything else counts as production. There's no prefix matching, and `isEnvironmentDevLike()` is untouched.
  - `isProductionEnvironment(env)`: the saved value if there is one, otherwise the guess. **The QA code should always read the flag through this**, never `env.isProduction` directly.
  - `withIsProduction(env)`: returns the environment with the flag filled in.
- **Filled in when the org is read.** `upgradeOrganizationDoc` maps environments that don't have the field through `withIsProduction`. Nothing is written back until the environment list is saved.
- **Internal API** (`environment.controller.ts`):
  - `postEnvironment` and `putEnvironments` fill the flag in with `withIsProduction`.
  - `putEnvironment` now merges `{ ...existing, ...body, id }` instead of replacing the environment outright. A save that leaves out a field (`isProduction`, or `parent`) no longer wipes it, and the response returns the merged environment.
- **REST API.** `isProduction` is always included in `apiEnvironmentValidator` responses, and it's optional on POST and PUT bodies. `validatePayload` fills it in, and the list endpoint returns it. `spec.yaml` and `docs/openapi.yaml` were regenerated.
- **UI.**
  - `EnvironmentModal` has a "This is a production environment" `Switch`, shown for both create and edit. When creating, picking or typing an ID pre-fills it from the guess, unless the user has already changed the switch.
  - The Environments list shows a "Production" badge next to the environment's name.
- **Tests:** `shared/test/environments.test.ts`, `back-end/test/migrations.test.ts`, `back-end/test/api/environments.test.ts`.

**Where it ended up different from the original plan**

- The switch is always visible. The plan hid it for default IDs.
- There's a badge next to the name instead of a separate column.
- The non-production names are just `dev`, `staging` and `test`. `development` and `qa` aren't included (this closes the old open question).

**What the QA branch has to do after rebasing**

- Remove `qaOverridesEnabled` everywhere. Expect conflicts in the first three files, which #7614 also changed.

  | File                                                                                       | References | Change                                                                                            |
  | ------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------- |
  | `shared/src/validators/environment.ts`                                                     | 2          | Delete; the field from #7614 replaces it                                                          |
  | `front-end/components/Settings/EnvironmentModal.tsx`                                       | 5          | Delete the "Allow QA overrides" switch; #7614's switch replaces it                                |
  | `front-end/pages/environments.tsx`                                                         | 1          | Delete; the Production badge replaces it                                                          |
  | `back-end/src/routers/environment/environment.controller.ts`                               | 2          | Change the cleanup hook to run when `isProductionEnvironment` goes from false to true (section 3) |
  | `back-end/src/models/ExperimentQaOverrideModel.ts`                                         | 1          | Validation becomes `!isProductionEnvironment(env)`                                                |
  | `back-end/src/services/features.ts`                                                        | 2          | Payload gate becomes `!isProductionEnvironment(env)`                                              |
  | `front-end/.../QaOverrideModal.tsx`, `QaOverridesSection.tsx`, `SdkQaOverridesSection.tsx` | 1 each     | Use `isProductionEnvironment` to decide which environments are eligible                           |

- Change the "no eligible environment" empty state from "Enable QA overrides on an environment" to "Mark an environment as non-production in Settings → Environments."

---

## 3. PR B: data model (overrides scoped to an environment)

Replace the per-connection document with:

```ts
experimentQaOverrideValidator = z
  .object({
    id,
    organization,
    dateCreated,
    dateUpdated,
    createdBy,
    experiment: z.string(), // readonly
    environment: z.string(), // required; must be non-production
    order: z.number(), // first match wins across an experiment's overrides
    filters: z.object({
      condition: z.string().optional(), // identifier / attribute targeting, stored as a condition (Jeremy)
      savedGroups: savedGroupTargeting.array().optional(),
      sdkConnections: z.array(z.string()).optional(), // empty = all connections in the env
      projects: z.array(z.string()).optional(),
    }),
    assignment: { type: "random" } | { type: "forced", variationId },
  })
  .strict();
```

- Remove `sdkConnection`, `applyExperimentTargeting`, `applyExperimentCoverage` and `additionalTargeting`.
- Remove the unique index on `(experiment, sdkConnection)`.
- Indexes: `(org, experiment)` and `(org, environment)`.
- **Store identifier filters as a condition** (Jeremy). The UI can still offer a simple "identifier is any of" input that compiles to `{attr: {$in: [...]}}`.
- Keep a shared base validator so the future `FeatureQaOverride` can extend it. The base now holds `environment`, `filters` and `createdBy`.

**Validation (`beforeCreate` / `customValidation`)**

- The environment exists and `isProductionEnvironment(env)` is false. Otherwise reject with "QA overrides aren't allowed on production environments."
- The experiment is a **draft** and not archived (decided 11/05). Otherwise reject with "QA overrides are only available while the experiment is in draft."
- The experiment type is `standard` or `multi-armed-bandit`.
- `variationId` exists in the latest phase.
- Every `sdkConnections` entry belongs to the environment, and every `projects` entry exists.

**Permissions (from your notes: "what is permissioning here?")**

- Keep `canRunExperiment(experiment, [environment])`. Scoping overrides to an environment fits this better, since permissions are already per environment.
- The SDK connection filter only narrows who receives the override, so it needs no permission of its own. Reading the connection list is already gated by `canReadSDKConnection`.
- An SDK connection is an app plus an environment. That fits the QA use case ("my local dev app") as a filter, not as the main scope.

**Lifecycle / "make sure you can delete properly"**

- `DELETE /qa-overrides/:id` and Stop all (`DELETE /qa-overrides/experiment/:id`) both queue a payload refresh for **every connection in the override's environment**. Payloads are keyed by environment and project.
- Delete overrides when:
  - the experiment leaves draft, or is archived or deleted. This is already built; re-check it after the scope change. It's the main way overrides get cleared now that the feature is draft-only.
  - an environment is changed to production (`isProductionEnvironment` goes from false to true). There are three handlers that can save this, and each needs the hook. The prototype only has the first.
    - internal `putEnvironment` (`environment.controller.ts`; the prototype's hook is there today, keyed on `qaOverridesEnabled`)
    - internal `putEnvironments` (bulk)
    - REST `putEnvironment` (`back-end/src/api/environments/putEnvironment.ts`)
      Compare the old and new values with `isProductionEnvironment` on both sides, so an environment that was only guessed counts correctly.
  - an environment is deleted.
- When a connection is deleted, remove its ID from `filters.sdkConnections`. If the list becomes empty, **delete the override** rather than widening it to the whole environment.
- Test: after a delete, the regenerated payload contains no QA rule for that experiment on any connection in the environment.

**Prototype data**

- No migration needed, since nothing has shipped. Drop the collection on dev databases.

---

## 4. PR C: payload changes (`util/features.ts`, `services/features.ts`)

**Loading**

- Group overrides by **environment**, not by connection.
- For each connection, keep the overrides where `filters.sdkConnections` is empty or includes the connection, and `filters.projects` is empty or shares a project with the connection.
- Only overrides on **draft** experiments are loaded. Skip all of this when `isProductionEnvironment(env)` is true. Checking again here is a second safeguard: an override saved before an environment was switched to production still won't be served.

**N rules per experiment-ref**

- The experiment-ref branch (~line 1422) currently turns one rule into one rule. Change it to emit **one QA rule per matching override**, in `order`, in place of the original rule. First match wins, the same as feature rules.
- A draft experiment with no overrides emits nothing, as today. Running experiments are untouched.

**`applyQaOverrideToRule` (~line 318), rewritten by mode**

|                                    | Random assignment                                             | Force variation       |
| ---------------------------------- | ------------------------------------------------------------- | --------------------- |
| condition                          | experiment condition + saved groups, **AND** override filters | override filters only |
| `parentConditions` (prerequisites) | keep                                                          | delete                |
| coverage                           | `phase.coverage`                                              | 1                     |
| weights                            | `phase.variationWeights`                                      | one-hot               |
| namespace                          | keep                                                          | delete                |
| feature holdout rule               | **bypass** (decided 11/05)                                    | bypass                |
| `key`                              | QA key                                                        | QA key                |
| `seed`                             | `phase.seed \|\| experiment.trackingKey` (**not** the QA key) | same                  |
| `disableStickyBucketing`           | true                                                          | true                  |

**Bypassing the holdout.** The holdout isn't part of the experiment rule. It's a separate force rule at the top of the feature (`holdoutRule`, `util/features.ts` ~1347). That rule uses `parentConditions` on `$holdout:<id>` = `holdoutcontrol` and serves the holdout value, so a user in the holdout never reaches the QA rule. Removing holdout fields from the QA rule therefore isn't enough. Options:

- **(Recommended) Omit `holdoutRule` for this feature** when building the payload for a connection that has an active QA override on any experiment linked to this feature. This is safe enough because it can only happen in a non-production environment and only while the experiment is a draft. The side effect is that the feature's other rules on that connection also stop being held out while the override exists. Note that on the override row.
- Alternatively, put the QA rules above `holdoutRule`. That would also skip the prerequisite rules and every other rule above the experiment rule, which contradicts the "keep the rules above the experiment rule as they are" decision. Not recommended.
- Also check `getAutoExperiments`: if visual editor or URL redirect experiments in a holdout get a holdout `parentCondition`, drop it on the QA version.

**Seed fix.** The prototype sets `rule.seed = rule.key` (line 324). Change it to `phase.seed || experiment.trackingKey`. With no explicit seed, the SDK hashes on `key`, and since the key changes, users would land in different buckets than in the real run. Luke wants an ID tested in QA to get the same variation once the experiment starts.

**Tracking key**

- Make it more distinctive than `__qa`, with symbols so it can't collide by chance. Proposal: `${trackingKey}$$gbqa`, or a prefix like `$qa:${trackingKey}` to mirror `$holdout:`.
- Before choosing, check which characters survive every warehouse event pipeline (key limits in GA4, Segment and Snowplow), and what dev tools parses.
- Update `QA_TRACKING_KEY_SUFFIX`, `isQaTrackingKey`, the check that stops real tracking keys from ending in the QA suffix, and the past-experiments import filter.

**Dev tools metadata (Bryce)**

- Add metadata to each QA rule: override ID, mode (`random` / `forced`), the original tracking key, and the forced variation. Dev tools can then show "overridden by QA, would have been X" and link back to the override so the user can undo it.
- Minimum fallback: dev tools recognises QA from the key, the same way it recognises holdouts by their prefix. Before adding new rule fields, check that every SDK ignores fields it doesn't know.

**Linked feature turned off in the environment**

- Don't force the feature into the payload. If the feature is off in that environment, or the experiment rule isn't in the live revision, the override is stored but **inactive** (see section 6).
- Rules above the experiment rule in the feature stay as they are. If they catch the user first, that's accepted; feature-flag QA is the answer for that case. The holdout rule is the one exception (see above).

**Visual editor / URL redirects**

- Same mode logic in `getAutoExperiments`. These aren't gated by feature revisions, so they work immediately.

---

## 5. PR D: UI (waiting on Gabe's mockups)

**Modal (top to bottom)**

1. **Environment.** Required single select, always visible. Production environments (`isProductionEnvironment`) are disabled with a note: "QA overrides aren't available on production. To use this environment, turn off 'This is a production environment' in Settings → Environments." Link to the Environments page.
2. **+ Add filter.** Optional, and you can add more than one: identifier/condition, saved group, SDK connection, project. Each filter expands into its own input.
3. **Which variation?**
   - `Random assignment` shows a read-only summary of the experiment's targeting and coverage, with helper text "Holdouts are ignored."
   - `Force variation` lets you pick the variation, with helper text "Experiment targeting, coverage, namespaces and holdouts are ignored."
4. **Remove** the "Experiment targeting" checkboxes and the old "Additional targeting" block.
5. **Linked-feature status.** When it applies, show a callout with "Enable now" (section 6).

**Section table**

- Shown only while the experiment is a draft.
- Columns: Environment · Filters · Variation (or "Random") · Status (Active / Waiting for feature) · Set by · Edit / Delete.
- When there's more than one override, add drag or up/down ordering, since the first match wins.

**SDK connection page section**

- Keep it, but list the overrides that **reach** this connection: same environment, and the connection filter is empty or includes it. Gabe confirmed the current UI has no SDK filtering, so this needs design too.

**For Gabe**

- Branch and screenshots are already promised.
- Ask for the modal, the section table, the inactive "waiting for feature" state, and the SDK connection page.
- Already confirmed with him: QA isn't supported once the experiment is running.

---

## 6. PR E: the linked feature isn't on yet

Agreed in the meeting (Jeremy, Bryce):

- **Let them create the override.** If any linked feature is off in the override's environment, or the experiment rule isn't in the live revision, show **"Won't apply until `<feature>` is enabled in `<env>`."**
- **Simple case.** When the environment doesn't require approvals, show an **"Enable now"** button in the modal and the section. It publishes a revision that turns the feature on in that environment.
- **Approvals required.** Create the draft revision with the environment turned on, then link the user to it to request approval. Never bypass approvals.
- **Applies automatically after approval.** Your idea, similar to auto-merge on GitHub: once the approval goes through, the override starts applying with no extra step. In practice this comes for free, because the override is already stored and the next payload refresh picks it up.
- Gabe heard "you can't configure it until the feature is live." The meeting and your notes say **create it now; it applies later.** Tell Gabe so the mockups show the inactive state, not a blocked button.

---

## 7. Results

- Punted (Luke, Bryce). The only requirement is that QA exposures never land in the main analysis, which the distinctive key guarantees.
- The exposure log / diagnostics toggle (old PR 6) stays optional. It only needs updating for the new key.

---

## 8. Decisions

- **Draft only (11/05).** QA overrides are only available while the experiment is a draft. Bryce raised QA on running experiments ("see what users are seeing"); it's out of scope for v1. If it comes back, the N-rules design extends naturally: the QA rules would go in front of the live experiment rule.
- **Default to production (11/05, shipped in #7614).** An environment counts as production unless its ID exactly matches `dev`, `staging` or `test`. There's no prefix or regex matching, and `isEnvironmentDevLike()` isn't reused. Users change it with the switch in Settings → Environments.
- **Drop holdouts in both modes (11/05).** Random assignment keeps the experiment's targeting, prerequisites, coverage and namespace, but not holdouts. This fits the framing of QA overrides as a dev-tools extension, not an end-to-end test. Mechanism: omit the feature's `holdoutRule` on connections with an active override (see section 4).

## 9. Open questions

1. **Exact key format.** Which characters are safe across the warehouse integrations and dev tools.
2. **Saved groups as a filter.** Agreed that it's allowed (people do keep "QA team" saved groups). Confirm it compiles the same way as experiment saved groups, including the `savedGroupStrategy` / `$inGroup` capability.
3. **Production opt-in later.** For now production is fully blocked. Jeremy wants an explicit opt-in in the future: an identifier filter would be required, and the user would be warned that the experiment config and the targeted IDs or emails leak into the production payload.
