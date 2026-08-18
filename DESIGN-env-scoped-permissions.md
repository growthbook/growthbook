# Environment-scoped permissions — findings and plan

Working notes for `bryce/env-scoped-review`. Written before any code, so the
decisions below are the thing to argue with.

Driving request: a customer wants a distinct approvals group for one environment,
separate from production. Today that is not expressible.

## Build rule: no comments

**No comments anywhere, unless the code is so confusing that one is needed.**
Then: `//` format, ELI5, **max 2 lines**. Rare exceptions for super important
backbone functions.

Prefer a clearer name, a smaller function, or a named constant over a sentence
explaining the mess. Never narrate history. Never repeat the same explanation at
two call sites — put it on the shared function once, or nowhere.

## What today's engine actually does

Verified against `main` at the branch point, not from memory.

**Resolution is already general.** `envsAllowedBy`
(`packages/shared/src/permissions/permissions.utils.ts`) takes a _list_ of
`envGrants` — each `{ permissions, environments, limitAccessByEnvironment }` —
filters to the grants carrying the permission being checked, and unions their
environments. It does not care how many grants there are or where they came from.

**The assignment surface is what's collapsed.** Each role assignment carries
exactly one environment restriction, and there is at most one assignment per
(principal, scope):

| Level              | Shape today                                              |
| ------------------ | -------------------------------------------------------- |
| Member global      | one `{ role, limitAccessByEnvironment, environments }`   |
| Member per project | `projectRoles[]`, but keyed by project — one per project |
| Team               | same two, on the team                                    |

A user only gets multiple environment-scoped grants by joining multiple teams.
That is the whole reason the multi-team workaround exists.

**Project beats global, and it replaces rather than merges.**
`(project && userPermissions.projects[project]) || userPermissions.global`.

The consequence people will not expect: **the environment restriction travels
with the winning role and is not inherited.** Global `engineer` limited to
`[dev]`, plus a `payments` role with no limit, means full production access in
`payments`. A global env limit is not a floor.

**Multi-project entities.** Read is `.some()` (any project suffices); everything
else is `.every()` (all projects required), with `envs` evaluated inside each
project's own grant — so writes require the _intersection_ of environment
authority across projects. Features are governance-primary
(`project` + `targetingProjects[]`), so this path applies to Saved Groups,
holdouts, segments and metric groups, not to flags.

**Bug found while checking the above.** Duplicate `projectRoles` entries for the
same project silently overwrite — `permissions.projects[pr.project] = …` is a
bare assignment in a loop (`packages/back-end/src/util/organization.util.ts`,
both the member loop and the per-team loop). Last one wins, no error. Across
_teams_ it merges correctly, because `mergeUserAndTeamPermissions` runs per team
and concatenates grants. Worth confirming whether any endpoint can currently
produce duplicates; if so, a rule can be silently ignored today.

## Decisions taken

1. **Review becomes environment-scopeable.** `review*` joins
   `ENV_SCOPED_PERMISSIONS`. Semantics follow the publish gate: you need review
   authority across **all** environments in the change's footprint. Not `any` —
   the two verbs should answer the same question the same way.

2. **Behind an org setting, default off.** Adding `review*` to the scoped set
   retroactively narrows every existing environment-limited role, silently, as
   refused approvals. On Cloud that lands for everyone at once.

3. **Environments keep union semantics.** No narrowing, no specificity ordering.
   Environments are bounded (2–4 per org), so single-layer rules are enough, and
   union is what makes the change below a no-op for existing data.

4. **Project-replaces-global stays.** Broad access by default, deliberately
   restricted on sensitive projects, is the right default. Revisit only if a
   concrete case demands additive.

5. **Governance-primary is the go-forward project shape** — one governing
   project, plus non-governing projects that extend delivery scope. Features
   already have it.

6. **No new model.** The `(project × environment)` cell is already the unit of
   assignment: `projectMemberRole = { project, role, limitAccessByEnvironment,
environments }`. There is a convention; extend it rather than replace it.

## The change

**One relaxation: "one assignment per scope" becomes "a list of assignments per
scope."** Applied at member-global, member-per-project, and team (which carries
the same two structures). That covers items 2, 3 and 4 of the original list.

Storage: `memberRoleInfo` → a list, with back-compat on read (a bare object
reads as a one-element list). Resolution is untouched — grant concatenation and
per-permission union already do the work.

Also fix the overwrite bug above, so a second rule for the same project merges
instead of vanishing.

**Regression risk is near zero, and that follows from decision 3.** Every
existing config has exactly one assignment per scope, contributes exactly one
grant, and unioning one grant is the identity. New behaviour appears only when
someone adds a second rule, which is opt-in by editing.

## Approvals are checked at publish, not cached

An approval is not a fact about the past, it is a claim about the change being
published. So it is evaluated **at publish time, against the footprint that
exists then** — not invalidated cleverly when something changes.

**An approval counts only if that approver holds review authority over the
current footprint.** Uncovered approvals simply do not count toward the required
number, and the existing "needs review" gate produces the refusal. No new error
path, no widening-detection logic.

Why publish-time beats invalidate-on-edit: **the footprint can widen with no
edit at all.** A rebase pulls in live changes; the flag gets enabled in a new
environment; targeting projects change. An edit-time invalidator sees nothing
happen in every one of those. This is the same lesson as the CAS authority work
— a check made earlier, against state that has since moved, is not a check.

Two consequences, accepted deliberately:

- It uses the approver's **current** permissions. Someone who loses production
  review rights stops covering drafts they approved weeks ago. Correct and
  fail-closed, but it means approvals can quietly stop counting after a role
  change — which is why the UI surfacing below is not optional.
- Do **not** snapshot the approver's authority at approval time. That is caching
  a derived permission answer and trusting it later, which is the exact failure
  mode this project keeps hitting.

Cost: one approver-permission load per approval at publish. Precedent exists —
deferred publish already resolves the arming user's context.

## Required approvers ("Team A must approve")

The ask: _these features should be approvable by Team A, those by Team B._

Two readings, wildly different costs:

- **"Only Team A's approval counts"** — a restriction on who may approve, scoped
  to an arbitrary set of features. Needs a third dimension in the permission
  model beyond (project × environment). Rejected: it undoes the simplification
  above.
- **"Team A must approve"** — a requirement on the approval set. CODEOWNERS.
  Cheap, because `RequireReview[]` is already the policy-rule shape scoped by
  project and environment. **Chosen.**

Operationally the second is what people want: "only Team A" means nothing ships
when Team A is on holiday, and it does not compose (finance _and_ the owning
team). Required-approvers gives the control without the deadlock.

It plugs into machinery that already exists. `getGoverningReviewProjects(primary,
targetingProjects, targetingReviewMode)` already returns _primary + strict-mode
targeting projects_ — the set whose review rules govern a change. The rule
becomes "for each governing review project, its required approver teams must
have signed off," and delivery-scope projects contribute their approvers for
free.

This does tie approver policy to project alignment, which is fine — that is what
a primary governance project is for. The escape hatch for cross-project approval
is already sanctioned: mark the secondary targeting project `strict`.

Same gate, two questions: _does this approval cover the footprint_, and _does the
approval set satisfy the rules_. One evaluation, at publish, against current
state.

## UI

The complaints — users visually decoupled from teams, teams from roles, roles
showing nothing about who holds them — describe a UI organised around _objects_
where the mental model is _policy_: who can do what, where.

The list change removes the worst of it by itself, since teams stop being the
only way to hold several rules.

The highest-value addition is an **effective-permissions view**: pick a user, see
the resolved answer per (project × environment) cell, and the rule that produced
it. It is mechanical on top of `userHasPermission`, and it makes the two
non-obvious behaviours above — env limits not inheriting, project replacing
global — self-explaining instead of tribal knowledge. Build it before any
cosmetic work.

Approval state needs two surfaces of its own:

- **When the footprint widens** — "this draft now affects production; Sam's
  approval only covers dev." Shown at the moment of the edit, so it is not a
  surprise at publish.
- **On the review screen** — per-approval coverage and unmet required-approver
  rules, so "2 approvals" does not read as done when one of them does not count.

The footprint is already computed for the publish gate, so both are display work
rather than new machinery.

### Marking an approval as insufficient

The approver avatars carry the state. A filled circle is an approval that counts;
a **green outlined circle** is an approval given by someone who cannot sanction
this draft — they can review `dev`, the draft changes `production`. The same
treatment goes on the event timeline entry in the left column, so the two
surfaces never disagree.

Four states, not two. The outline has to sit alongside the existing ones without
colliding:

| State                         | Mark                 |
| ----------------------------- | -------------------- |
| Not yet reviewed              | grey / empty         |
| Approved, sanctioned          | filled green         |
| Approved, insufficient rights | dashed green outline |
| Changes requested             | red                  |

**Prerequisite — met.** `reviewFeatures`, `reviewConfigs` and `reviewConstants`
were in `PROJECT_SCOPED_PERMISSIONS` when this was written, so "can approve dev
but not prod" was not expressible and the outlined state could never occur.
Section 2 has since landed: the review atoms are environment-scoped, so the state
is reachable and is what the coverage UI now renders.

**The rule.** An approval is sanctioned when the approver's review environments
cover the draft's `PublishFootprint`:

- `scope: "environments"` — reviewer's envs must be a superset of the footprint's.
- `scope: "unscoped"` (`NO_ENVIRONMENT_BINDING` — metadata, a base Config value,
  a Constant's base value) — **fails closed** per the resolved decision above:
  the reviewer's authority must be unrestricted by environment. An environment-
  limited reviewer shows as outlined here, which is the least intuitive case and
  so the one whose tooltip matters most.
- `scope: "everywhere"` — needs review rights in every environment.

**The tooltip is derived, not written.** Same lesson as the environment badge on
the role rules table: name the environments that are actually missing for that
reviewer's actual role — "Sam can review dev and staging. This draft changes
production." A hardcoded string goes stale the moment the role or the footprint
changes.

**The icon is advisory; the gate is the authority.** The publish gate must count
only sanctioned approvals. If the display and the gate can ever disagree in the
permissive direction, this becomes the same shape as the churn family from the
granular-permissions PR: an optional input whose default is the permissive
answer.

**Sufficiency is computed at publish, against the current footprint** — never
frozen at the moment of approval, because the footprint grows when someone adds a
production rule to a draft that was dev-only. Verified: `reviewCycle` is `$inc`d
on submit-for-review, on recall/retract, and on revert-to-draft, and reviews are
demoted to `approved-stale` when a revision re-enters `pending-review`. What is
NOT yet confirmed is whether an edit that widens the footprint _while already in_
`pending-review` invalidates standing approvals — `approvedBaseVersion` looks
like the mechanism, and it needs a test pinning it before this ships. If it does
not, a dev-only approval could silently become "sufficient" for a draft that
later added production.

**Resolved — partial coverage does not sum.** One approver must cover the whole
footprint; two half-covering approvals do not combine. An approval is an
attestation about the whole change, not a per-environment vote, and requiring
summed approvals across environments is rare enough not to justify tracking
coverage sets in the counting logic and explaining partially-covered drafts in
the UI.

**Where the stale-approval hole actually is.** Two mechanisms already demote an
approval when a draft changes, and neither closes this:

- `resetReviewOnChange` flips a revision from `approved` back to `pending-review`
  when the edit touches a gated environment or the default value — but only when
  the org enabled that setting, and only from `approved`.
- `clearReviews` stales recorded verdicts, but only on a _status transition_ into
  `pending-review`, not on an edit made while already there.

So a draft sitting in `pending-review` with one recorded approval, which then
grows to touch production, keeps that approval — regardless of any setting. The
approver could not have given it against the current draft. Section 3 has to
re-derive the footprint at publish and re-check each recorded approver against
it; demoting status is not sufficient.

## Settings audit: which org settings actually apply to which entity

Prompted by noticing the UI/copy diverges from what is applied. Verified by
tracing each setting's consumers, not from the settings page.

| Setting                                                                                                           | Features        | Constants | Configs | Saved Groups    |
| ----------------------------------------------------------------------------------------------------------------- | --------------- | --------- | ------- | --------------- |
| `requireRebaseBeforePublish`                                                                                      | yes             | yes       | yes     | yes             |
| `restApiBypassesReviews`                                                                                          | yes             | yes       | yes     | yes             |
| `blockPublishOnSchemaError`                                                                                       | yes             | yes       | yes     | n/a (no schema) |
| `requireReviews` (+ `resetReviewOnChange`, `featureRequire*Review`, `blockSelfApproval`, `autopublishOnApproval`) | yes             | yes       | yes     | **no**          |
| `approvalFlows`                                                                                                   | **no**          | **no**    | **no**  | yes             |
| `maxConcurrentDrafts`                                                                                             | yes (REST + UI) | **no**    | **no**  | **no**          |
| `targetingReviewMode`                                                                                             | yes             | **no**    | **no**  | n/a             |
| `featureRegexValidator` / `featureKeyExample`                                                                     | yes             | **no**    | **no**  | n/a             |

### Two parallel approval-configuration systems

`getApprovalFlowSettings` (`packages/shared/src/revisions/helpers.ts`) switches on
entity type: `saved-group` gets `approvalFlows.savedGroups[0]`, everything else
gets `undefined` and falls back to `requireReviews`. `ApprovalFlowConfigurations`
has exactly one key, `savedGroups`.

So #6456 unified this family's _permissions_ while its _approval configuration_
stayed split: three entities on `RequireReview[]` (scoped by project +
environment), Saved Groups on a different shape entirely.

**This gates required-approvers.** Building it on `RequireReview[]` ships it for
three of four entities and silently skips Saved Groups — the exact divergence
this project keeps removing. Decide first: implement twice, or move Saved Group
approval onto `requireReviews`. Full unification is a settings migration on live
orgs and is probably not worth it; the narrow question is only about
required-approvers.

### Settings copy: currently feature-framed, and in one case ahead of the code

After unifying, the settings UI needs to say these govern the whole flag family,
not just Feature Flags. Three specific strings:

| Setting                  | Copy today                                                                                | Problem                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxConcurrentDrafts`    | "Cap number of drafts allowed **per Feature Flag**"                                       | Label needs widening once the cap applies to the other three. The behaviour description is accurate for the New Draft modal, but not for the draft-strategy widget — see below. |
| `restApiBypassesReviews` | "…unless the caller's role grants FlagsBypassApprovals on the **Feature Flag's** Project" | Setting applies to all four entities; copy names one.                                                                                                                           |
| `targetingReviewMode`    | "When a **Feature Flag** is delivered into Targeting Projects…"                           | Accurate today (behaviour really is feature-only). Must change _with_ the extension, not before.                                                                                |

Sequencing note: `restApiBypassesReviews` copy is simply too narrow and can be
fixed any time. `targetingReviewMode` copy is correct today and would become
wrong the moment the behaviour is extended — so copy and behaviour move together
there.

### Dead settings on the saved-group approval config

`ApprovalFlowConfiguration.canBypassReview` and `.resetReviewOnChange` are
declared, sit under a literal `// TODO: Should we add support for these
additional settings?`, and are **never read**. They look like working settings to
anyone reading the type — and given the two parallel approval-config systems
above, someone will assume they are wired. Delete until there is demand, or
implement.

### Unify where cheap

- **`targetingReviewMode` → Constants and Configs.** A genuine gap, not a
  preference: those entities already carry `targetingProjects`, so today a
  Constant delivered into a secondary project cannot say whether that project's
  review rules apply. This is also the mechanism required-approvers leans on for
  cross-project approval, so it should work everywhere before anything is built
  on it.
- **`maxConcurrentDrafts` → the other three, plus one inconsistency to settle.**
  The implementation is fine and stays as-is: REST counts active drafts, refuses
  with a clear message, `?overrideDraftLimit=true` proceeds. The UI implements it
  too — I originally reported otherwise, from grepping only the back-end.

  What is actually wrong is that the **two UI surfaces apply different policies
  to the same setting**:

  | Surface                                           | At the cap                               | Admin at the cap                                    |
  | ------------------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
  | New Draft button / modal (`FeaturesOverview`)     | warns, offers "Acknowledge and override" | same                                                |
  | Draft-strategy widget (`DraftSelectorForChanges`) | **disables** "Create a new draft"        | **silent** — only an untitled `(Recommended)` nudge |

  The widget computes `newDraftBlocked = atDraftCap && !isAdmin &&
!allowNewDraftAtCap`, so the reason string never renders for an admin, and the
  cap is invisible to them. The modal treats the cap as soft-and-acknowledgeable,
  which matches the setting's own copy; the widget treats it as a hard block with
  an admin exemption.

  Settle on the modal's treatment — callout plus acknowledge, for everyone —
  since `allowNewDraftAtCap` already exists as the escape hatch. Drop the
  widget's `isAdmin` exemption with it: the modal has no admin concept, so once
  both surfaces let anyone acknowledge, `!isAdmin` implies a policy that is no
  longer in force. Then extend to the other three entities. Confirm the per-entity (not per-org, not per-user)
  counting is intended for them rather than inherited by accident.

- **`featureRegexValidator` / `featureKeyExample` — leave feature-only.**
  Deliberate, not an oversight: feature keys are SDK call sites, while Constant
  and Config keys are referenced inline as `@const:` / `@config:` tokens. A
  naming convention that suits one need not suit the others. Recorded so the
  divergence is not "fixed" later by someone reading the table above.

## Open questions

- **Environment-scope the bypass atoms — all four.** The permission already
  exists per entity (`bypassApprovalFeatures`, `…Configs`, `…Constants`,
  `…SavedGroups`, declared as data in `revisionPermissions.ts`) and is uniformly
  project-scoped today (`bypass: "project"`, absent from
  `ENV_SCOPED_PERMISSIONS`). So there is no per-entity gap in the permission
  itself; the work is env-scoping **all four atoms** rather than the
  feature-shaped one that `canBypassFlagApprovalChecks(feature, "feature")` makes
  it look like. Cost is one line in the constant plus threading a footprint into
  callers that do not take one today. Park it; pick it up if it falls out.
- **Does the metadata escape hatch cover Constants and Configs?**
  `featureRequireMetadataReview` is consumed in the feature review path. If it
  does not cover the other two, fail-closed on their metadata has no lever.

## Resolved

- **Coverage is re-derived on every publish path, including deferred ones.**
  Verified by reading each path rather than assumed: both engines converge on a
  single check (`publishRevisionInner` for the generic engine,
  `publishFeatureRevision` for features), and the armed/scheduled paths call
  those same functions at fire time under the armer's context
  (`maybePublishScheduledRevision` in both `revisionActions.ts` and
  `autoPublishOnApproval.ts`). So a schedule armed while an approval covered the
  draft is refused if the approval no longer covers it when it fires, and the
  refusal is recorded for the "stuck" indicator. Nothing is stored, so there is
  no armed-at snapshot to go stale.

  Reverts are not an exception: a revert that becomes a draft publishes through
  those same paths, and a direct revert carries no approval to be stale — it is
  gated on revert authority plus `revertFootprint`.

- **The no-environment-binding case: fail closed.** Metadata edits, a Constant's
  base value and a base Config carry `NO_ENVIRONMENT_BINDING`, which is a bare
  `[]` whose own comment warns it "would skip environment checks". Review
  authority for these requires authority unrestricted by environment. The
  annoying case — metadata — already has a dedicated lever
  (`featureRequireMetadataReview`), which is what makes one uniform rule
  preferable to splitting the bucket by how inert each member is.

  Note this bucket is _not_ homogeneous in effect: a Constant's base value is
  "unbound" only in the sense of having no per-environment override — it is
  inherited by every environment that does not override it, production included.
  Worth confirming separately whether the **publish** gate currently skips the
  environment check for such a change, since that would be a live instance of the
  vacuous-empty-footprint bug rather than a question about this feature.

- **Duplicate `projectRoles` is a live bug.** No dedup anywhere: the validators
  are bare `z.array(projectMemberRole)` on the member-role endpoint, both API-key
  endpoints and teams, and the resolver assigns rather than merges. Two rules for
  one project silently collapse to whichever is last, so it fails in _both_
  directions depending on array order — `[engineer, readonly]` grants less than
  configured, `[readonly, engineer]` grants more. The UI likely prevents it; the
  API does not.

  The fix and the feature are the same change: merging per scope (union) is
  exactly what "a list of assignments per scope" does. Consequence to state
  openly — after the fix, union means the more permissive rule wins, so adding a
  restrictive rule is never a way to take access away. Restriction remains the
  job of the role assigned, not of an extra rule.

## Known divergence, decision pending

Saved Groups are governed by `projects[]` (governance = the array, resolved with
`.every()`), while Features, Configs and Constants are governance-primary. Same
permission family after #6456, same verbs, two project models — and nothing in
the code or UI signals the difference. Migrating Saved Groups to
`project` + `targetingProjects[]` is what makes the family uniform. Already on
the roadmap; recorded here so it is not re-litigated as a bug.

## Prior art in the codebase

Two existing precedents for policy scoped by both dimensions — worth matching
rather than inventing:

- `RequireReview[]` — `{ requireReviewOn, resetReviewOnChange, environments[],
projects[], … }`
- `TargetingReviewRule[]` — `{ projects[], mode }`, "most-specific-wins"

The permission system is the outlier in not having this shape.

## Build checklist

### 0. Decisions

- [ ] **Saved Groups: `approvalFlows` or `requireReviews`?** DEFERRED — revisit
      before section 4 ships, since required approvers built on `RequireReview[]`
      covers three of four entities otherwise.
- [x] **Leave `unscoped` publish as-is.** A Constant base-value or metadata
      change stays publishable by an env-limited publisher. Audited: it is the
      only substantive fail-open in the flag-family publish path. The other two
      skip-paths are correct by construction — Saved Groups have no
      `publishFootprint` but also no env-scoped permissions, and
      `envsAllowedBy`'s `if (!envs) return true` only serves non-env-scoped
      checks. Revisit if it starts to matter.
- [x] **`featureRequireMetadataReview` covers all three.**
      `constantRequiresReview` honours it directly; `configRequiresReview`
      delegates to `constantRequiresReview`. Only the name is feature-flavoured.
      So fail-closed on metadata has a working lever everywhere.
- [x] **Per-entity draft counting is intended** for the other three.

**Trap for section 2 — now guarded by a test.** `saved-group.adapter` implements
no `publishFootprint`, and `resolvePublishFootprint` opens with
`if (!footprint || footprint.scope === "unscoped") return []`. An adapter that
never implemented one and a deliberate unscoped change collapse to the same
skip value — an absence and a decision producing the same permissive answer,
the same shape as the churn family from the granular-permissions PR.

That is safe today only because **no saved-group atom is env-scoped**. Saved
Groups have the full family (`createSavedGroups` … `publishSavedGroups`), but
every one sits in `PROJECT_SCOPED_PERMISSIONS`, publish included — unlike the
other three families, whose `publish*` is env-scoped.

`back-end/test/publishFootprintCoverage.test.ts` now asserts, per revision
target type: implements `publishFootprint`, **or** has no env-scoped atom.
Mutation-checked — env-scoping `reviewSavedGroups` fails the saved-group case
and leaves the other two green.

**Rule this gives section 2.** `review*` is env-scoped **iff** `publish*` is,
per family — because the point is that you may not approve what you could not
publish. So `reviewSavedGroups` does not move, and that is a consequence of the
model rather than a carve-out.

### 1. Multiple rules per scope (the model change) — DONE

- [x] `memberRoleInfo` → a list, back-compat read (bare object = one-element list)
      — `additionalRoles` is optional, so an untouched member reads as one rule
- [x] Member global: accept and resolve a list
- [x] Member per project: accept several rules for one project
- [x] Teams: same two changes
- [x] Replace assign-with-merge in both loops in `organization.util.ts` — fixes
      the silent-overwrite bug
- [ ] Reject or dedupe duplicates at the API boundary — **still open, but
      downgraded**: the merge is a union, so a duplicate rule is inert rather
      than harmful, and the editor now marks it "Already covered". Data hygiene,
      not correctness.
- [x] Tests: one rule = identical to today; two rules union; duplicate project
      merges instead of vanishing — `back-end/test/additionalRoles.test.ts`

Landed alongside, not originally listed:

- [x] Every role-assigning surface uses one rules table — member, default role,
      team permissions, create team, invite, API key, orphaned user
- [x] Project overrides are first-class in the editor rather than a separate widget
- [x] Fixed two silent data drops: the member list and the team permissions modal
      both omitted `additionalRoles` when reading into their forms
- [x] Tests pinning member+team project-override union, and both directions of
      "a project rule drops the other principal's global role"

### 2. Review becomes environment-scoped

- [x] No org setting: `review*` atoms are statically environment-scoped. An
      earlier draft gated this behind `settings.envScopedReview`; that setting
      never existed on prod, so it was dropped rather than shipped — orgs that
      lose review rights are handled case by case.
- [x] `review*` sits in the env-scoped set, so per-role `envGrants` carry the
      review atoms
- [x] `revisionActionPermission()` answers "environment" for review; saved groups
      excluded (review is env-scoped only where publish is)
- [x] No-binding changes fail closed — an empty footprint satisfies `every()`, so
      reviewing an unbound change now takes authority unrestricted by environment
- [x] Generic adapter `canReview` routed through the footprint-supplying helper;
      it was the one action that never received one
- [x] Tests: `shared/test/permissions/envScopedReview.test.ts`, nine cases
      covering flag off (no change), per-env, spanning, unbound, saved groups
- [x] Feature engine wired: `getReviewAuthorityFootprint` (in `shared/util/features.ts`)
      feeds `controllers/features.ts`, `services/features.ts` and
      `services/featurePublishGates.ts`. Resolution of the question below: **(b)**.

**Resolved: what is a Feature revision's review footprint?**

Constants and Configs already carry a per-revision footprint, so wiring them was
mechanical. Features do not. Feature _publish_ gates on
`getEnabledEnvironments(feature, environments)` — every environment the feature
is enabled in — because publishing a revision rewrites the whole rules map.

Two readings, and they behave very differently:

- **(a) Match publish.** Footprint = the feature's enabled environments.
  Consistent with the publish gate and needs no new derivation. But a dev-only
  reviewer could then never approve any draft on a feature that is enabled in
  production, which makes env-scoped review close to all-or-nothing for
  Features — most of the value gone.
- **(b) What the draft changes.** Footprint = environments whose rules differ
  from live, plus every enabled environment when the default value changed.
  This is what the customer described ("they can approve dev, draft has prod
  changes") and what the "footprint widens" UI above assumes.

**(b) is what shipped.** `bases` takes a LIST — the live revision and the draft's
base — unioned, so the two disagreeing (the v1/v2 drift) can only ever demand
more authority, never less. **Derived, never stored** — a revision already holds its full
staged state (`defaultValue`, `rules`, `environmentsEnabled`, `metadata`), so the
delta is a pure function of (revision, base) and there is nothing to accumulate.
An earlier draft of this note said "deriving and storing", which conflated two
different questions: `changedEnvironments` is computed per-mutation because
_"does this edit trip the review requirement"_ is genuinely a per-edit question,
whereas _"what would publishing this draft change"_ is a whole-draft-versus-live
question answerable at any time.

Storing it would be worse, not just unnecessary:

- It is a **derived permission input**, and the resolved decision above already
  refuses to snapshot the approver's side for exactly this reason. Freezing the
  draft's side is the same mistake facing the other way.
- It would **go stale without the draft changing**. The footprint is relative to
  live, and live moves when someone else publishes. A value computed at edit
  time is wrong by the time it is read.
- It would need invalidating on every mutation, rebase, and neighbouring
  publish — a cache with a hard invalidation problem and no benefit.

Cost of deriving is two revision loads (live and base) at approve/publish, on
the same order as the approver-permission load this design already accepts.

The one legitimate reason to _record_ a footprint is audit: "what did this
approval cover at the time?" alongside the review event, for display. That is
history, not a decision input — the gate must still derive.

Second-order: the review check in `controllers/features.ts` ran _before_
`getRevision`. Resolved by splitting it — comments keep the pre-fetch refusal,
verdicts move after, so 403-before-404 survives for anyone with no review rights
at all.

### 3. Approvals checked at publish

- [x] An approval counts only if that approver covers the current footprint —
      `assessApprovalCoverage`, called from both engines' publish paths
- [x] Uncovered approvals do not count; the publish gate refuses with a message
      naming the environments the approvers cannot approve
- [x] Uses approvers' current permissions; no snapshotting
- [x] Tests: `approvalCoverage.test.ts`, `revisionApprovalCoverage.test.ts`,
      `reviewAuthorityFootprint.test.ts`, `reviewFootprintGeneric.test.ts`
- [x] Approver avatars: dashed outline when insufficient, with a tooltip and a
      "not a qualifying approval" suffix on the timeline row
- [x] Same marking on the left-column event timeline, including approvals that
      carry a comment (those render as cards, which needed the suffix separately)
- [x] Tooltip derived from the reviewer's role and the current footprint —
      `uncoveredApproverReasons`, naming the environments they cannot approve
- [ ] Still open: whether `approvedBaseVersion` re-evaluates a standing approval
      when the footprint widens _during_ `pending-review`. The widening semantics
      themselves are covered (`approvalCoverage.test.ts` discounts an approval once
      the draft grows past the approver); what is unverified is the feature
      engine's own stale-approval mechanism interacting with it.

### 4. Required approvers

- [ ] `requiredApproverTeams` on `RequireReview[]`
- [ ] Enforced at the same publish gate
- [ ] Evaluated per governing review project (`getGoverningReviewProjects`)
- [ ] Saved Groups per decision 0

### 5. Settings unification

- [ ] `targetingReviewMode` → Constants and Configs
- [ ] `maxConcurrentDrafts` → the other three entities
- [ ] One draft-cap policy across both UI surfaces (modal's warn+acknowledge);
      drop the widget's `isAdmin` exemption
- [ ] Delete `ApprovalFlowConfiguration.canBypassReview` /
      `.resetReviewOnChange` (`organization.d.ts:231-233`, both read nowhere).
      Name the type when doing it: `RequireReview.resetReviewOnChange` is a
      different field and is live.
- [ ] Copy: widen `maxConcurrentDrafts` and `restApiBypassesReviews`; update
      `targetingReviewMode` copy _with_ its behaviour change
- [ ] Leave `featureRegexValidator` / `featureKeyExample` feature-only

### 6. UI

- [ ] Effective-permissions view: per (project × environment), with the rule that
      produced it
- [x] Multiple-rules editor on member, project and team
- [ ] Footprint-widened warning at the moment of the edit
- [ ] Per-approval coverage and unmet required-approver rules on the review screen
      — design settled, see "Marking an approval as insufficient"; blocked on 2

### Parked

- [ ] Environment-scope the bypass atoms — all four, not just features
- [ ] Saved Group migration to governance-primary `project` + `targetingProjects[]`

## Backlog: deny-by-default projects (customer request)

> When a project has explicit project roles assigned to teams, everyone else
> still falls through to their organization-wide role on that project. To make a
> project effectively private we have to attach an explicit low-privilege role to
> everyone who isn't on the owning team — roughly 550 people pushed through SCIM
> purely to hold Read Only on one project. Is there a way to make a project
> deny-by-default, so only explicitly granted teams have access and admins retain
> theirs? A per-project setting would be ideal.

Confirmed behaviour, not a misconfiguration. `permissionsClass` resolves a
project permission as `projects[project] || global` — an explicit project entry
_replaces_ global, but its **absence** falls through. There is no way to express
"absence means no access", so privacy has to be simulated by giving everyone an
explicit entry. That is why the workaround scales with headcount instead of with
the number of people who should have access.

The seam is small and sits in code this branch already reworked:

- A per-project flag (`project.settings.denyByDefault`, default off so nothing
  changes for existing orgs).
- In resolution, when the project is deny-by-default, absence of a project entry
  yields **no permissions** rather than the global object. Admins and super
  admins keep access, matching how `roleSupportsEnvLimit` already exempts them.
- `mergeUserAndTeamPermissions` already builds a per-project entry whenever any
  principal — the member or any of their teams — has a project role, so a team
  grant is enough to produce the entry that grants access.

Two things to get right, both of which the current shape makes easy to miss:

- **Reads.** `userHasPermission` treats `READ_ONLY_PERMISSIONS` as "allowed if
  allowed in at least one project", and it _adds_ every project the user has an
  entry for. A private project must not leak through that some-project path, or
  the flag hides writes but not the data.
- **Fail closed.** The default must be "no entry means deny" only when the flag
  is on; the flag itself must never be inferred from absence of configuration.

Worth pairing with the effective-permissions view above: deny-by-default is
exactly the setting people will want to verify rather than trust.
