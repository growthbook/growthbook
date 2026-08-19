# Flag-Family Authority Model

The authority rules for the entities that share a revision workflow — Feature
Flags, Configs, Constants and Saved Groups. Read this before changing any
permission check on those entities, on either side of the wire.

It exists because the recurring bug in this area is not a missing check. It is a
check that asks the _wrong question_ — the right function called about the wrong
project, the wrong verb, or the wrong set of environments. Those read as correct
in review, because every individual line looks like a permission check. This
page is the canonical statement to check a call against.

For the general permission system (scopes, `usePermissionsUtil`,
`context.permissions`, commercial features) see `permissions.md`. This page is
only about the flag family's revision actions.

## The four nouns

Every authority decision in this area is four choices. Getting any one wrong
produces a check that passes when it should refuse, or refuses when it should
pass.

| Noun          | The question                                                        | Where it comes from                                           |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Verb**      | Which atom — draft, review, publish, revert, delete, create, bypass | The operation, not the caller's role                          |
| **Scope**     | Which project's grant applies                                       | The entity, or the _destination_ when the change relocates it |
| **Footprint** | Which environments the change reaches                               | The change, not the entity                                    |
| **Basis**     | Which state the question is asked about                             | Live entity, revision snapshot, or restored state             |

`REVISION_PERMISSIONS[model][action]` in `shared/permissions/revisionPermissions`
maps verb → (permission, scope class) for every entity. It is the only place that
mapping lives; never re-derive it.

## Verb: two verbs, not one

A change has up to two authority questions, and they are answered separately:

- **Draft** is project-scoped. Staging a change publishes nothing, so it carries
  no environment footprint.
- **Publish** is environment-scoped. Landing a change is what reaches users.

An ordinary edit is both. This is why "can the user edit this?" is not a
well-formed question: a drafter may stage what they may not land, and a publisher
may land what they did not write.

Two verbs subsume others in specific, deliberate ways:

- **Archiving is delete-class** wherever it lands — via an archive endpoint, or
  as a revision that happens to set `archived`. Unarchiving returns the entity to
  service and is an ordinary publish.
- **A narrow atom lands a change that only does what that atom covers**: revert
  authority lands a draft that only restores a previously published state, delete
  authority lands one that only archives. Purity is proven, never assumed —
  `isPureFeatureRevert` / `isPureArchiveRevision` and friends.

`assertCanLandRevision` (back-end/src/revisions/landAuthority) is the single
implementation of those rules. Callers inject the footprint and the purity
proofs; they do not re-implement the arms.

## Scope: a move takes authority in the destination

A change that relocates an entity is a write to where it lands, so it needs
authority there as well as where it came from. The source may ride a narrow atom;
**the destination never does**, because there is no revision there to judge
purity against.

`holdsMoveDestination` (shared/permissions/moveAuthority) is the only place a
destination is derived. It is vacuously true when nothing moves, so call it
unconditionally rather than guarding it with your own "did this move?" test.

The destination's verb is the verb of the operation you are performing, not the
atom that carried the source side:

| Operation               | Destination verb |
| ----------------------- | ---------------- |
| Publishing a draft      | `publish`        |
| Landing a direct revert | `revert`         |
| Staging any draft       | `draft`          |

## Footprint: derived from the change, never from the entity

The footprint is the set of environments a change actually reaches:

- A Feature Flag revision: the serving environments whose rules change, plus any
  the change enables or disables. A rule change in a disabled environment reaches
  no payload, so it needs no authority there. This is the same rule as archive
  below.
- A Constant or Config: the per-environment overrides that differ.
- A Saved Group: none — it is not partitioned by environment.
- A **revert**: the environments where the _restored_ state differs from
  **current live** — not what the historical revision changed when it was
  published, which a later change can have superseded.
- An **archive**: everywhere the entity is in service. For a Feature Flag that
  is the environments it is applicable AND enabled in — a disabled environment
  already serves no payload for it, so archiving changes nothing there. Configs,
  Constants and Saved Groups have no per-environment enabled toggle, so their
  archive reaches every applicable environment (`archiveServeFootprint`). The
  two rules are deliberately different; do not unify them without deciding
  which flags-disabled-everywhere case should win.
- A new Feature Flag: exactly the environments it starts enabled in. A flag that
  starts disabled everywhere reaches no payload and needs create authority alone.

An empty footprint means "this action is not bound by environment" and makes the
environment half of the check **pass vacuously**. That is correct for a Saved
Group and for staging a draft. It is a security hole anywhere else, and it is the
single most common way a wrong check looks right. `NO_ENVIRONMENT_BINDING` exists
so the intent is legible at the call site — use it when you mean it, and never
reach for `[]` to make a type fit.

## Basis: which state answers

- **Landing** asks about the live entity plus the change.
- **Commenting** asks about the revision's snapshot — a comment belongs to the
  revision, whose project may predate a move.
- **A verdict** asks about the revision as the write sees it. Authority checked
  against a read is stale by the time it writes: a concurrent rebase can move the
  revision, so review authority is re-asserted inside the CAS
  (`reviewAuthorityOnRow`).
- **A revert** asks about the restored state versus current live
  (`getConstantRestoreChange` and its siblings).

## Write sequencing

See [Revision Architecture](./revisions-architecture.md#landing-sequence) for
the shared ordering and compensation contract.

## Where a rule may live

- Rules shared by both apps: `shared/permissions`.
- What a **control may offer**: `shared/permissions/controlAuthority`. Never
  inline in a page or component. A prediction re-derived at a call site drifts
  from the endpoint it predicts.
- Server enforcement: `back-end/src/revisions/*Authority.ts`.

The model-layer backstop (`canTouchRevision`) is the union of every verb on
purpose: a revision document is written by drafting, reviewing, reverting,
publishing and archiving alike, and the model cannot see which. Anything narrower
refuses writes the handler already allowed — two layers giving one request two
answers.

## Tests that hold this together

Change any rule here and these are the tests that should move with it:

- `back-end/test/api/permission-matrix-revision-entities.test.ts` — personas ×
  operations, driving real endpoints against an executable oracle.
- `back-end/test/api/permission-prediction-parity.test.ts` — the same oracle
  applied to the control-side predictions, so a control and its endpoint cannot
  disagree without CI failing.
- `back-end/test/revisions/landingSequence.test.ts` and
  `landDirectChange.test.ts` — the ordering contract above.

If you are adding an authority rule and cannot see which of those it belongs in,
the rule is probably in the wrong place.
