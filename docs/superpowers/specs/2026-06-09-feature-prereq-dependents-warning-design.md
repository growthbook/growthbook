# Feature Prerequisite "Dependents" Warning — Design

**Date:** 2026-06-09
**Status:** Approved (pending spec review)

## Problem

When a feature is used as a **prerequisite** by other features (or experiments), changing
that feature can silently alter the behavior of the dependents. Today the app surfaces this
only as a passive "Dependents" panel at the bottom of the feature overview page, and the
external REST API exposes nothing about it at all. Users editing or publishing a feature —
or integrating via the API — get no heads-up.

## Goal

Warn users at the point of change (UI) and expose dependent relationships over the REST API,
so a change that affects other features is never a surprise.

## What already exists (no change needed)

- **Reverse-dependency lookup** is fully built:
  - `buildReverseDependencyIndex(features)` and `getDependentFeatures(...)` /
    `getDependentExperiments(...)` in `packages/shared/src/util/features.ts`.
  - `buildFeatureLookups(allFeatures, allExperiments)` in
    `packages/back-end/src/util/features.ts`.
  - Internal endpoint `GET /features/dependents?ids=...` + the
    `useFeatureDependents(featureId)` front-end hook
    (`packages/front-end/hooks/useFeatureDependents.ts`), returning
    `{ features: string[]; experiments: { id: string; name: string }[] }`.
- **Passive "Dependents" panel** on the overview page
  (`FeaturesOverview.tsx` ~line 1755) — stays as-is.
- **Archive & Delete (internal UI)** already use `useFeatureDependents`, render a callout via
  `FeatureReferencesList`, and **fully block** the action when dependents exist
  (`FeatureArchiveModal.tsx`, `FeatureDeleteModal.tsx`) — stays as-is.

## Scope

Two parts: front-end warnings in the edit/publish flows, and REST API changes.

---

## Part 1 — Front-end: informational warning in edit/publish flows

The three flows that change a feature but have **no** dependents awareness today get a
non-blocking warning. The warning never disables the save/publish CTA (per decision:
informational only).

### New component: `DependentFeaturesWarning`

Location: `packages/front-end/components/Features/DependentFeaturesWarning.tsx`

- **Props:** `{ featureId: string }`.
- Calls `useFeatureDependents(featureId)` internally.
- Renders **nothing** while loading or when total dependents `=== 0` (invisible in the common
  case — zero friction).
- When dependents exist, renders a `<Callout status="warning">`:

  > "This feature is a prerequisite for N other feature(s)/experiment(s). Changing it may
  > affect their behavior."

  followed by the existing `<FeatureReferencesList features={...} experiments={...} />` for the
  expandable list of links.

- Count + pluralization copy live **only** here, not duplicated across the three modals.

### Wiring (3 sites)

Render `<DependentFeaturesWarning featureId={feature.id} />` near the top of each modal body:

1. `packages/front-end/components/Features/DraftModal.tsx` — publishing a draft (the real
   "goes live" moment).
2. `packages/front-end/components/Features/EditDefaultValueModal.tsx` — editing the default
   value.
3. `packages/front-end/components/Features/RuleModal/index.tsx` — editing rules (top of the
   modal, above the paged steps).

### Non-goals (front-end)

- No change to the passive overview panel.
- No change to Archive/Delete modals (already block).
- No tests — presentational component; the only logic is trivial count/pluralization
  (repo policy: no tests for FE components).

---

## Part 2 — REST API

Reuses the same backend reverse-dependency code path the internal `/features/dependents`
controller uses (`buildFeatureLookups` → `getDependentFeatures` / `getDependentExperiments`).
Applies to **both v1 and v2** unless noted.

### 2a. `dependents` field on the feature response

- Add an optional `dependents` object to the API feature schema(s):
  - `apiFeatureValidator` in `packages/shared/src/validators/features.ts`
  - `apiFeatureV2Validator` in `packages/shared/src/validators/features-v2.ts`
  - Shape (mirrors the internal hook for consistency):
    ```
    dependents?: {
      features: string[];
      experiments: { id: string; name: string }[];
    }
    ```
- Populate it in the serializers when the handler supplies a reverse-dependency index; omit
  otherwise (optional field):
  - `getApiFeatureObj` and `getApiFeatureObjV2` in
    `packages/back-end/src/services/features.ts` gain an optional input (e.g.
    `dependents?: { features; experiments }` precomputed by the handler, or the
    reverse index + all features/experiments needed to compute it).
- **Wired into single-feature responses only:**
  - `GET /features/:id` (`getFeature.ts`, `getFeatureV2.ts`)
  - `POST /features` create (`postFeature.ts`, `postFeatureV2.ts`)
  - `PUT/POST /features/:id` update (`updateFeature.ts`, `updateFeatureV2.ts`)
- **Deliberately NOT on the list endpoint** (`listFeatures.ts` / `listFeaturesV2.ts`).
  Computing it requires the org's full feature + experiment set, which would defeat list
  pagination for large orgs. The field is optional, so omitting it on list is schema-valid
  and consistent.

### 2b. `warnings` on the update response

- Define a generic warning schema (reusable for future warning types):
  ```
  { type: string; message: string }
  ```
- Add an optional `warnings` array to the **update response envelope** (not inside the
  feature object). Today update returns `{ feature }` via `featureResponseSchema`
  (`features.ts:1210`). Introduce a dedicated update response schema:
  ```
  z.object({ feature: apiFeatureValidator, warnings: warningSchema.array().optional() }).strict()
  ```
  and the v2 equivalent.
- After a successful update, if the feature has dependents, append one warning:
  > `{ type: "prerequisiteDependents", message: "This feature is a prerequisite for N other feature(s)/experiment(s). Your change may affect them." }`
- Non-blocking — informational only, mirroring the UI callout. Whenever the updated feature
  has dependents (matching the UI, which shows the callout whenever dependents exist,
  regardless of which fields changed).

### 2c. Block DELETE on v2 only

- v1 and v2 delete currently **share** `deleteFeatureHandler` in
  `packages/back-end/src/api/features/deleteFeature.ts`.
- Parametrize the handler so only v2 blocks on dependents:
  ```
  export function makeDeleteFeatureHandler({ blockOnDependents = false } = {}) {
    return async function deleteFeatureHandler(req) {
      // ...existing fetch + permission checks...
      if (blockOnDependents) {
        // load org features (+ experiments), compute dependents for this feature
        // if any exist, throw a clear error listing them — do NOT delete
      }
      // ...existing delete...
    };
  }
  ```

  - `deleteFeature.ts` (v1): `createApiRequestHandler(deleteFeatureValidator)(makeDeleteFeatureHandler())` — unchanged behavior.
  - `deleteFeatureV2.ts`: `createApiRequestHandler(deleteFeatureV2Validator)(makeDeleteFeatureHandler({ blockOnDependents: true }))`.
- Error: a clear message naming the blocking dependent feature/experiment IDs, instructing the
  caller to remove the prerequisite references first (matches the internal UI block intent).
- v1 delete keeps current behavior (no block), per decision.

### 2d. Docs

- Add `.describe(...)` on the new schema fields.
- Run `pnpm --filter back-end generate-openapi` and commit the regenerated
  `packages/back-end/generated/spec.yaml`.

### Cost note

Each affected GET / create / update (and the v2 delete) now loads the org's full feature
(+ experiment) list to compute dependents — the same query cost the internal
`/features/dependents` endpoint already pays. Scoped to single-feature endpoints; list is
unaffected.

---

## Decisions log

- Warning weight (edit/publish): **informational callout**, non-blocking.
- UI sites: DraftModal, EditDefaultValueModal, RuleModal.
- API `dependents`: single-feature responses only (not list).
- API versions for `dependents` + update `warnings`: **both v1 and v2**.
- DELETE block: **v2 only**.

## Files touched (summary)

**Front-end**

- `components/Features/DependentFeaturesWarning.tsx` (new)
- `components/Features/DraftModal.tsx`
- `components/Features/EditDefaultValueModal.tsx`
- `components/Features/RuleModal/index.tsx`

**Shared**

- `src/validators/features.ts` (add `dependents` to `apiFeatureValidator`; new warning schema;
  update response schema with `warnings`)
- `src/validators/features-v2.ts` (add `dependents` to v2; v2 update response with `warnings`)

**Back-end**

- `src/services/features.ts` (`getApiFeatureObj`, `getApiFeatureObjV2` accept/emit dependents)
- `src/api/features/getFeature.ts`, `getFeatureV2.ts` (compute + pass dependents)
- `src/api/features/postFeature.ts`, `postFeatureV2.ts` (compute + pass dependents)
- `src/api/features/updateFeature.ts`, `updateFeatureV2.ts` (compute + pass dependents; build warnings)
- `src/api/features/deleteFeature.ts` (parametrize handler), `deleteFeatureV2.ts` (block on dependents)
- `generated/spec.yaml` (regenerated)
