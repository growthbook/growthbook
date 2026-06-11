# Standardizing `environments` semantics across webhook events

Status: proposal (design only — no implementation yet)

## Problem

The top-level `environments` field on event webhook payloads means different
things depending on the event family, and neither semantic is documented:

- **`feature.updated` (and other live-state events)** — populated by
  `getChangedApiFeatureEnvironments(previous, current)` in
  `packages/back-end/src/events/handlers/utils.ts`: the environments whose
  effective configuration _actually changed_ in this transition.
- **`feature.revision.*` (draft lifecycle events)** — populated by
  `deriveRevisionEventEnvironments(...)` in
  `packages/back-end/src/services/featureRevisionEvents.ts`: the environments
  the revision _touches_ (union of rule scopes, falling back to the feature's
  configured envs), filtered to the feature's project.

Both arrays feed the same webhook environment filter
(`filterEventForEnvironments`), so a subscriber filtered to `production` gets
meaningfully different matching behavior between the two event families.
Anyone building event-driven tooling has to reverse-engineer this from source.

There is also an empty-array footgun with _opposite_ semantics on the two
sides of the filter:

- An empty **subscription filter** matches every event.
- An **event** with an empty `environments` array matches _no_ env-filtered
  subscription — it silently disappears from filtered feeds. A metadata-only
  edit (no changed envs) is invisible to anyone with an env filter, even
  though they would almost certainly want it.

## Reframe: one semantic, with a refinement

The two computations are not competing interpretations. There is a single
semantic:

> `environments` = the environments this event is relevant to.

with a refinement that is only definable for state transitions:

- **`applicable`** ("where does this object operate?") — the universal
  computation, valid for every event. Union of rule scopes with
  `allEnvironments: true` expanded via project-filtered org envs
  (`getApplicableEnvIds`). This is the more fundamental of the two: it
  incorporates org-level environment/project configuration that the payload
  does **not** otherwise carry, so consumers cannot reconstruct it themselves.
- **`changed`** ("where did behavior just move?") — a _refinement_ of
  `applicable`, definable only when a before/after pair exists (live-state
  events). It is pure denormalization: derivable by the consumer from
  `data.object` / `data.previous_object` / `data.changes`, which are already
  in the payload. Its only job is routing precision.

Derivation rule for the routing field, applied uniformly:

```
environments = changed   // when a before/after transition exists
             ?? applicable
             ?? null     // not environment-scoped → deliver to all
```

## Proposed shape

Keep the existing envelope (it already has `api_version`, `projects`, `tags`,
`environments` at the top level). Changes:

1. **One helper, one rule.** Collapse the two computations into a single
   exported helper with a branch on "is this a state transition?", used by
   every event producer. Routing field and payload facts are produced by the
   same call so they cannot drift.

2. **Named payload facts.** Add to `data`:

   ```jsonc
   {
     "data": {
       "object": { ... },
       "previous_object": { ... },   // live-state events only
       "changes": { ... },
       "environments": {
         "changed": ["production"],              // live-state events only
         "applicable": ["production", "staging"] // always present when env-scoped
       }
     }
   }
   ```

   `data.environments.applicable` carries the **resolved** environment list —
   `allEnvironments: true` rules are expanded at dispatch time. Rules in
   `data.object.rules` keep their unresolved scopes; the resolved list is the
   authoritative expansion.

3. **Point-in-time resolution.** The expansion must be computed at event
   creation and persisted in the stored payload. Org environments are mutable
   (envs added/removed, project scoping changed), so resolving lazily at read
   time would retroactively rewrite event history.

4. **Null, never empty array.** `environments: null` (or absent) means "not
   environment-scoped — deliver to all subscribers." A non-empty array means
   "scoped to exactly these." Empty arrays are never produced. This is the
   only **breaking** part of the proposal (delivery sets change for existing
   filtered subscribers) and should be gated on an `api_version` bump — the
   field exists in the envelope today and has never been used for a semantic
   change.

5. **Schema-as-docs.** The named fields get `.describe()` strings on their
   Zod validators so the semantics are generated into the event webhook docs
   (`docs/src/partials/event-webhook/_event-webhook-list.md`) and cannot go
   stale in separate prose.

## Per-family summary

| Event family                                                                                                                              | `applicable` | `changed`                | routing field           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------ | ----------------------- |
| `*.created` / `*.updated` / `*.deleted`, `revision.published` / `reverted`                                                                | yes          | yes                      | `changed`               |
| `revision.created` / `updated` / `reviewRequested` / `approved` / `changesRequested` / `commented` / `discarded` / `rebased` / `reopened` | yes          | — (nothing live changed) | `applicable`            |
| Non-env-scoped events (org settings, members, …)                                                                                          | —            | —                        | `null` (deliver to all) |

## Migration notes

- Items 1–3 and 5 are additive and non-breaking: existing subscribers see the
  same routing behavior, plus new disambiguated fields inside `data`.
- Item 4 (null-vs-empty-array) changes delivery sets and needs a
  deprecation/migration story tied to `api_version`.
- Today's flat `environments` routing field is unchanged in shape, so existing
  subscription filters keep working throughout.

## Origin

Raised by a customer: "the environments field appears to mean different
things in `feature.updated` (environments that changed) versus
`feature.revision.*` (environments touched) webhook payloads — a docs or
semantics clarification would help anyone building event-driven tooling."
