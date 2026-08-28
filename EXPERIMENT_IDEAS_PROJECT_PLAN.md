# GrowthBook Experiment Ideas — AI Agent Project Plan

## Purpose

Build a new Experiment Ideas system where permitted team members can capture a title and description, develop an idea with structured and organization-defined metadata, convert it into one or more draft experiments, and follow the lineage through experiment results and saved Learnings.

This is a new product implementation. Do not revive or extend GrowthBook's obsolete legacy Ideas subsystem.

The intended lifecycle is:

```text
prior Learnings → Experiment Idea → one or more Experiments → results → resulting Learnings
```

The MVP must remain a lightweight experimentation backlog. It must not become a general-purpose project-management system.

## Instructions for the implementing agent

1. Read the repository `AGENTS.md` and the relevant guides in `.agents/guides/` before changing an area.
2. Treat the decisions in this document as the current product requirements.
3. Report a material codebase mismatch before making a broad architectural substitution.
4. Preserve unrelated work and existing customer data.
5. Do not delete or migrate production legacy Idea records without a separately approved data-retention decision.
6. Implement the work as small, reviewable pull requests in the sequence below.
7. Use repository conventions and existing components instead of creating parallel infrastructure.

## Confirmed product decisions

- Use a new `experimentIdeas` collection and a new `ExperimentIdeaModel`.
- Do not store new Experiment Ideas as Learnings or in the legacy `ideas` collection.
- Initial capture contains:
  - Required title.
  - Immediately visible optional description.
  - Any administrator-configured required Experiment Idea custom fields.
- An Idea belongs to one optional project. No project means organization-wide.
- Organizations may configure their own Idea stages.
- Default stages are New, Candidate, and Ready.
- Stage IDs are immutable; labels, colors, order, and the default stage are configurable.
- Converted, Testing, Tested, Learning available, and Archived are system-derived states, not configurable stages.
- A user with experiment-creation permission may convert an Idea from any stage.
- One Idea may produce multiple Experiments.
- Store the Idea relationship on the Experiment; do not also maintain an `experimentIds` array on the Idea.
- Ideas may cite prior Learnings that informed them.
- Resulting Learnings are derived through linked Experiments.
- Ideas are available independently of the Learnings commercial entitlement.
- Learnings-specific UI is conditional on Learnings availability and access.
- Custom fields reuse GrowthBook's existing custom metadata system and entitlement.
- Voting, popularity scores, impact scores, Kanban, campaigns, AI ranking, semantic deduplication, and autonomous experiment execution are not in the MVP.

## Existing repository context

### Legacy Ideas subsystem

The repository still contains an old Ideas implementation, even though it is absent from current sidebar and command-palette navigation.

Relevant legacy code includes:

- `packages/shared/types/idea.d.ts`
- `packages/back-end/src/models/IdeasModel.ts`
- `packages/back-end/src/services/ideas.ts`
- `packages/back-end/src/controllers/ideas.ts`
- Legacy routes mounted directly in `packages/back-end/src/app.ts`
- `packages/front-end/pages/ideas.tsx`
- `packages/front-end/pages/idea/[iid].tsx`
- `packages/front-end/components/Ideas/`
- `packages/front-end/components/HomePage/IdeasFeed.tsx`
- Legacy `createIdeas` and `IdeasFullAccess` permission entries
- Legacy `experiment.ideaSource`
- Metric, segment, report, discussion, import, fixture, and test references

The old product model includes votes, impact scoring, estimates, and single-conversion assumptions. These concepts do not match the new requirements.

Do not silently map legacy records into the new collection. Legacy cleanup and legacy data retention are separate concerns.

### Learnings subsystem

Learnings are a separate retrospective entity representing evidence-backed conclusions. The current implementation provides useful patterns:

- Strict shared validators in `packages/shared/src/validators/learnings.ts`
- `MakeModelClass` usage in `packages/back-end/src/models/LearningModel.ts`
- Owner/authors attribution
- Project-aware permissions
- Configurable organization-level statuses
- Audit logging
- Stable list and detail routes
- Supporting and contradicting Experiment relationships
- Discussions
- External API conventions
- Embedding and AI search infrastructure

Reuse these architectural patterns and small shared utilities. Do not reuse the Learning collection, Learning document schema, Learning statuses, `manageLearnings` permission, `learnings` commercial gate, AI prompts, or refresh behavior.

### Custom fields subsystem

Custom fields currently support `feature` and `experiment` sections. Relevant infrastructure includes:

- `packages/shared/src/validators/custom-fields.ts`
- `packages/shared/types/custom-fields.d.ts`
- `packages/back-end/src/models/CustomFieldModel.ts`
- `packages/back-end/src/util/custom-fields.ts`
- `packages/front-end/hooks/useReconciledCustomFields.ts`
- `packages/front-end/services/customFields.ts`
- `packages/front-end/components/CustomFields/`

The current helpers filter custom fields for a single project. This is the reason the MVP uses one optional project per Idea instead of a `projects` array.

## Architecture

### Resource boundaries

Keep Experiment Ideas, Experiments, and Learnings as separate resources:

- Experiment Idea: a prospective hypothesis or opportunity.
- Experiment: a test definition, execution, and result.
- Learning: a reusable conclusion supported or contradicted by completed Experiments.

Sharing a collection would force conditional permissions, entitlements, indexes, validation, audit behavior, APIs, and AI logic. Separate collections provide clearer ownership and lower the risk of destabilizing Learnings.

### Relationship ownership

Use one authoritative relationship for each direction:

1. Add `sourceExperimentIdeaId?: string` to the Experiment schema.
2. Query Experiments by `sourceExperimentIdeaId` to list all Experiments produced from an Idea.
3. Keep Learning `supportingExperimentIds` and `contradictingExperimentIds` authoritative for Experiment-to-Learning evidence.
4. Derive an Idea's resulting Learnings by finding Learnings that cite its linked Experiments.
5. Store `informedByLearningIds` on the Idea for prior Learnings that inspired it.
6. Query Ideas by `informedByLearningIds` to show Ideas inspired by a Learning.

Do not store redundant reverse arrays. This avoids partial two-sided writes and repair jobs.

## Proposed data model

Names and length limits may be adjusted to established repository conventions during implementation.

```ts
const experimentIdeaSourceValues = ["manual", "api", "agent"] as const;

const experimentIdeaValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    project: z.string().optional(),

    title: z.string(),
    description: z.string(),
    hypothesis: z.string(),
    expectedOutcome: z.string(),
    rationale: z.string(),
    productArea: z.string(),

    owner: ownerField,
    createdBy: z.string(),
    authors: z.array(z.string()),
    tags: z.array(z.string()),
    metricIds: z.array(z.string()),

    stage: z.string(),
    archived: z.boolean(),
    dateArchived: z.date().nullable(),
    archivedBy: z.string().nullable(),

    source: z.enum(experimentIdeaSourceValues),
    informedByLearningIds: z.array(z.string()),
    customFields: z.record(z.string(), z.unknown()),

    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();
```

Use BaseModel `defaultValues` instead of Zod `.default()`.

Recommended defaults:

```ts
{
  description: "",
  hypothesis: "",
  expectedOutcome: "",
  rationale: "",
  productArea: "",
  owner: "",
  tags: [],
  metricIds: [],
  authors: [],
  archived: false,
  dateArchived: null,
  archivedBy: null,
  source: "manual",
  informedByLearningIds: [],
  customFields: {},
}
```

Use an ID prefix that cannot be confused with legacy `idea_` IDs, such as `ide_`. Confirm the final prefix does not conflict with an existing resource.

`createdBy` and `source` are immutable. `owner` is semantically optional and uses the repository's existing empty-string convention when unset; it may be reassigned. Append editors to `authors` following the Learnings convention. Populate `stage` from the organization's configured default in the create service rather than as a static BaseModel default.

### Idea stages

Store a stage ID on each Idea. Store stage definitions in organization settings.

Proposed shape:

```ts
type ExperimentIdeaStage = {
  id: string;
  label: string;
  color?: LearningStatusColor;
};

type ExperimentIdeaWorkflowSettings = {
  stages: ExperimentIdeaStage[];
  defaultStageId: string;
};
```

Default definitions:

```ts
[
  { id: "new", label: "New", color: "gray" },
  { id: "candidate", label: "Candidate", color: "blue" },
  { id: "ready", label: "Ready", color: "green" },
];
```

Requirements:

- New custom stage IDs use an immutable generated prefix such as `ideast_`.
- Stage labels are required and case-insensitively unique within the organization.
- Reserve the system-derived labels and identifiers `Converted`, `Testing`, `Tested`, `Learning available`, and `Archived` so configurable stages cannot create ambiguous UI.
- Stage order is the order of the settings array.
- The configured default stage must exist and be active.
- Renaming, recoloring, or reordering does not rewrite Idea documents.
- A stage referenced by Ideas cannot be deleted without a reassignment operation.
- If a historical stage definition is unavailable, preserve the stored ID and display Unknown stage.
- No permission or conversion behavior may depend on a label or default ID.

Only users who can manage organization settings may configure stages. Idea editors may select any configured stage.

### System-derived states

Do not store these as stages:

- Converted: at least one linked Experiment exists.
- Testing: at least one linked Experiment is running.
- Tested: at least one linked Experiment has completed.
- Learning available: a Learning cites at least one linked Experiment.
- Archived: `idea.archived === true`.

Show these as badges, counts, or summary information independent of the configurable stage.

### Custom fields

Extend `customFieldSectionValues` with a distinct section:

```ts
export const customFieldSectionValues = [
  "feature",
  "experiment",
  "experiment-idea",
] as const;
```

Update:

- Shared validators and OpenAPI descriptions.
- `CustomFieldSection` types.
- Settings labels and filters to display Experiment Ideas.
- Settings explanatory copy.
- API validation for custom-field definitions.
- Frontend reconciliation and rendering call sites.

Store Idea values in `customFields: Record<string, unknown>` and validate them server-side with `validateCustomFieldsForSection` using:

```ts
{
  section: "experiment-idea",
  project: idea.project,
}
```

Reuse:

- `useReconciledCustomFields`
- `CustomFieldInput`
- `CustomFieldDisplay`
- Defaults, required flags, project restrictions, inactive behavior, and type-specific validation

Required custom fields:

- If an administrator marks an Experiment Idea custom field required, show it in the initial capture form.
- The backend must reject create/update payloads missing required applicable values.
- Optional custom fields appear under additional details.
- An organization's deliberate governance requirement may therefore make capture require more than title and description.

Commercial behavior:

- Custom fields remain governed by the existing `custom-metadata` commercial feature.
- A downgrade must not erase already stored values.
- Values should remain visible read-only when appropriate, following existing product behavior.

Backlog behavior:

- Display custom fields on the detail page.
- Support exact-match list filters for enum, multiselect, and boolean fields in the MVP.
- Do not promise arbitrary text search or sorting across every dynamic field without a performance design.
- Avoid unbounded dynamic MongoDB indexes.

Experiment conversion behavior:

- Copy an Idea custom-field value only when that field definition applies to both `experiment-idea` and `experiment` for the selected project.
- Do not copy Idea-only fields.
- Show copied values in the reviewable Experiment form before creation.
- Let the user edit or remove copied values before submitting.
- Validate the final Experiment custom fields using the existing Experiment path.

## Permissions and availability

Add one new project-scoped mutation permission for the MVP:

```text
manageExperimentIdeas
```

It authorizes create, update, stage changes, archive, and restore within permitted project scope.

Read access follows normal project data access. Organization-wide Ideas follow the repository's established behavior for project-scoped resources with no project.

Rules:

- Do not repurpose legacy `createIdeas` automatically; doing so could grant existing roles unexpected access to the new feature.
- Decide explicitly which built-in roles receive `manageExperimentIdeas` during the permissions implementation.
- Creating an Experiment additionally requires normal Experiment creation permission.
- Configuring Idea stages requires organization-settings permission.
- Configuring custom fields requires the existing custom-field permission and entitlement.
- Learnings links must respect both Learning entitlement and resource access.
- Archived Ideas remain readable to authorized users.

Use a rollout flag for internal and design-partner enablement. Do not couple the entire Ideas feature to the Learnings commercial gate.

## Backend API

Use a new router under `packages/back-end/src/routers/`; do not add new legacy routes directly to `app.ts`.

Suggested internal endpoints:

```text
GET    /experiment-ideas
POST   /experiment-ideas
GET    /experiment-ideas/:id
PUT    /experiment-ideas/:id
POST   /experiment-ideas/:id/archive
POST   /experiment-ideas/:id/restore
GET    /experiment-ideas/:id/lineage
```

The list endpoint supports:

- Standard repository pagination.
- Text search over title, description, hypothesis, expected outcome, and rationale.
- Filters for stage, archived, project, owner, creator, tags, product area, metric, prior Learning, and supported custom-field types.
- Sorting by updated date, created date, and title.
- Default sort by most recently updated.
- Archived excluded by default.

The detail or lineage response should include permission-filtered summaries rather than requiring the client to make N+1 requests:

- Linked Experiments.
- Derived system states.
- Prior Learnings.
- Resulting supporting and contradicting Learnings.
- `canManage` or equivalent server-derived action capability when consistent with repository patterns.

Validation requirements:

- Trim and validate title and description.
- Use explicit request allowlists.
- Validate project, owner, metrics, Learnings, stage, and custom fields within the current organization.
- Reject cross-organization references.
- Reject inaccessible project-scoped references.
- Do not accept a raw database document from the client.
- Do not include Idea text in analytics payloads.

### Experiment relationship

Add to the Experiment shared validator and persistence model:

```ts
sourceExperimentIdeaId: z.string().optional();
```

Keep legacy `ideaSource` separate and deprecated. Do not reinterpret legacy IDs as new Experiment Idea IDs.

On Experiment creation with `sourceExperimentIdeaId`:

- Load the Idea in the current organization.
- Verify read access to the Idea.
- Verify normal Experiment creation permission for the chosen project.
- Verify the Idea and Experiment projects are compatible according to the final product rule.
- Allow multiple Experiments to reference one Idea.

Conversion uses the existing Experiment creation form. The Idea action opens a reviewable, editable form; it does not create immediately.

Suggested field mapping:

| Experiment Idea          | Experiment                                          |
| ------------------------ | --------------------------------------------------- |
| Title                    | Name                                                |
| Description              | Description                                         |
| Hypothesis               | Hypothesis                                          |
| Project                  | Project                                             |
| Tags                     | Tags                                                |
| Metrics                  | Candidate goal/guardrail selections for user review |
| Compatible custom fields | Experiment custom fields                            |

Do not silently select one primary metric when several are associated with the Idea.

### Conversion idempotency

Prevent double submission from creating unintended duplicate Experiments.

Preferred approach:

- Generate a client submission/idempotency key when the conversion form opens.
- Send it with the Experiment creation request.
- Enforce uniqueness within the organization and operation scope using an established repository pattern or a dedicated persisted key.
- Return the original successful result on a retry with the same key and equivalent request.
- Return a conflict for incompatible reuse of the same key.

Do not rely only on disabling the submit button.

Because the Experiment owns the relationship, successful Experiment creation does not require a second Idea update. Derived conversion state appears automatically.

## Frontend behavior

### Navigation and routes

- Add Ideas under the Experimentation navigation section.
- Use a stable user-facing list route, preferably `/ideas` after the legacy page is removed.
- Use a stable detail route such as `/ideas/[id]`.
- Keep internal API routes named `/experiment-ideas` to distinguish the new resource from legacy APIs.

### Capture

The initial form contains:

- Required title.
- Immediately visible description.
- Applicable required Experiment Idea custom fields.

Optional details include:

- Hypothesis.
- Expected outcome.
- Rationale.
- Owner.
- Project.
- Tags.
- Product area.
- Metrics.
- Prior Learnings.
- Optional custom fields.

Save must be keyboard accessible, resilient to double submission, and preserve user input after errors.

### Backlog

Show:

- Title.
- Description excerpt.
- Configurable stage.
- Owner.
- Project.
- Product area or tags.
- Linked metric count.
- Linked Experiment count and derived testing state.
- Creator.
- Updated date.
- Selected custom fields where the existing list pattern supports configurable columns.

Support search, filters, sorting, pagination, URL-backed state, archived visibility, empty/loading/error states, and read-only behavior.

Start with a table or list, not a Kanban board.

### Detail page

Show:

- Title and description.
- Configurable stage.
- Hypothesis, expected outcome, and rationale.
- Owner, creator, authors, project, product area, tags, and metrics.
- Custom fields.
- Prior Learnings that informed the Idea.
- All linked Experiments and their statuses.
- Resulting supporting and contradicting Learnings.
- Derived system-state badges.
- Discussion.
- Audit-relevant timestamps.
- Edit, archive/restore, and Create Experiment actions as permitted.

### Learning integration

On an Idea:

- Allow selecting accessible prior Learnings in the create/edit form.
- Display prior Learnings separately from resulting Learnings.
- Derive resulting Learnings from linked Experiments.
- Distinguish supporting from contradicting evidence.

On a Learning:

- Add Create Idea from Learning for permitted users.
- Open a reviewable Idea form with `informedByLearningIds` prefilled.
- Optionally prefill title or description, but never save AI- or system-generated wording without review.
- Display Ideas inspired by the Learning by querying `informedByLearningIds`.

If Learnings are unavailable, hide creation and selection affordances without breaking the rest of the Idea experience.

## Indexes and query design

Confirm indexes against actual MongoDB query plans before launch.

Candidate indexes:

- Experiment Ideas: organization + updated date.
- Experiment Ideas: organization + archived + stage + updated date.
- Experiment Ideas: organization + project + archived + updated date.
- Experiment Ideas: organization + owner + archived.
- Experiment Ideas: organization + tags.
- Experiment Ideas: organization + metric IDs.
- Experiment Ideas: organization + informed-by Learning IDs.
- Experiments: organization + `sourceExperimentIdeaId`.
- Learnings: indexes supporting queries by supporting or contradicting Experiment IDs if current plans do not already provide them.

Do not create a compound MongoDB index containing multiple array fields. Use query-specific multikey indexes where necessary.

For initial text search, use the established repository approach. Do not introduce an Atlas-only dependency without confirming self-hosted compatibility.

## Legacy retirement plan

Implement legacy retirement in a separate PR before or independently from the new feature foundation.

Remove obsolete code exposure and dependencies only after verifying each reference:

- Legacy frontend pages and components.
- Orphaned home feed.
- Legacy backend controllers, services, model imports, and mounted routes.
- Metric and segment dependency warnings or cleanup paths.
- Report and experiment response fields that load legacy Ideas.
- Legacy discussion parent handling if no retained UI needs it.
- Legacy permission names, built-in policy mappings, settings UI, and documentation.
- Import mappings and fixtures.
- Tests that exist only for the old feature.

Data safety:

- Do not drop the legacy collection in the code-cleanup PR.
- Do not remove `experiment.ideaSource` from persisted schemas until historical usage is audited.
- Mark legacy fields deprecated where they must remain readable.
- Decide separately whether legacy data is retained indefinitely, exported, migrated through a reviewed mapping, or deleted.
- If deletion is approved later, implement a scoped migration with dry-run counts and rollback or backup guidance.

## Delivery sequence

### PR 0 — Legacy retirement

Scope:

- Remove obsolete exposure and code dependencies.
- Preserve legacy data and persisted relationship compatibility.
- Remove or deprecate old permissions deliberately.

Merge gates:

- No remaining user-facing navigation or directly mounted mutation surface for legacy Ideas.
- No build, type, permission, metric, segment, report, import, or discussion regressions.
- No legacy database deletion.

### PR 1 — Backend foundation

Scope:

- Shared Experiment Idea and stage validators.
- Organization settings for stages and default stage.
- Custom field `experiment-idea` section.
- Experiment Idea BaseModel, context registration, audit events, indexes, and permissions.
- CRUD, list, archive, restore, and lineage services/endpoints.
- Experiment `sourceExperimentIdeaId` schema and persistence support.

Merge gates:

- Organization and project isolation verified.
- Stage, owner, metric, Learning, and custom-field validation complete.
- Archived excluded from list by default.
- Unknown fields rejected.
- No changes to Learning semantics or entitlement.

### PR 2 — Capture and backlog

Scope:

- Navigation and routes.
- Title-and-description capture.
- Required and optional custom fields.
- List, filters, sorting, pagination, URL state, and empty/error/loading states.
- Detail/edit, stage changes, archive/restore, and discussion.
- Organization stage-settings UI.

Merge gates:

- Fast capture works for organizations without required custom fields.
- Required custom fields are enforced consistently in UI and backend.
- Read-only users cannot mutate.
- Accessibility and responsive layout reviewed.

### PR 3 — Experiment conversion

Scope:

- Reviewable prefilled Experiment form.
- Compatible custom-field mapping.
- Idempotency protection.
- Experiment source link and Idea Experiment list.
- Multiple Experiments per Idea.
- Derived Converted, Testing, and Tested states.

Merge gates:

- Retry cannot unintentionally create duplicate Experiments.
- Every new relationship is organization- and project-validated.
- No second Idea write is required for relationship consistency.
- Experiment and Idea links work in both directions.

### PR 4 — Learnings loop and launch hardening

Scope:

- Prior Learning selection.
- Create Idea from Learning.
- Ideas inspired by a Learning.
- Derived resulting supporting and contradicting Learnings.
- Privacy-safe product analytics.
- Rollout flag, internal enablement, performance checks, and final QA.

Merge gates:

- Ideas work with and without Learnings entitlement.
- Hidden or inaccessible Learnings do not leak through summaries or counts.
- Telemetry contains IDs and categorical metadata only, never Idea text.
- Indexes support observed query patterns.

## Testing and verification

Follow repository testing policy: test utilities and helper logic; do not add tests for frontend components or backend routers/controllers/models.

Targeted automated coverage should include:

- Validator normalization and limits.
- Configurable stage validation, unique labels, default stage, and deletion/reassignment rules.
- Permission utility behavior across organization-wide and project-scoped Ideas.
- Custom-field filtering, reconciliation, required values, project changes, and compatible conversion mapping.
- Pure conversion field-mapping helpers.
- Idempotency helper or service logic.
- Derived system-state helpers.
- Learning lineage aggregation helpers with inaccessible resources removed.
- Tenant and project isolation through the repository's established integration approach where permitted by existing test conventions.

Run proportionate checks for each PR:

```bash
pnpm --filter shared type-check
pnpm --filter back-end type-check
pnpm --filter front-end type-check
pnpm pretty:check
```

Run targeted package tests for changed utilities and permission logic. Run broader tests when shared permission or custom-field changes affect many consumers.

End-to-end smoke path:

1. Configure Idea stages and choose a default.
2. Configure global and project-scoped Experiment Idea custom fields, including one required field.
3. Create an organization-wide Idea with title, description, and required custom metadata.
4. Create a project-scoped Idea with optional hypothesis, owner, tags, metric, and prior Learning.
5. Search and filter by stage, owner, project, tags, metric, archive state, and supported custom fields.
6. Open the shareable detail URL as another authorized user.
7. Convert the Idea into a draft Experiment and review mapped fields.
8. Retry the same submission and verify no unintended duplicate is created.
9. Create a second Experiment from the same Idea.
10. Start and stop a linked Experiment and verify derived state changes.
11. Create or update a Learning citing the Experiment and verify it appears on the Idea.
12. Create a new Idea from that Learning and verify the prior-Learning relationship.
13. Archive and restore the original Idea.
14. Verify a user without Learnings access can still use the Idea without leaked Learning data.

## Telemetry

Instrument categorical, privacy-safe events such as:

- `experiment_idea_created`
- `experiment_idea_updated`
- `experiment_idea_stage_changed`
- `experiment_idea_archived`
- `experiment_idea_restored`
- `experiment_idea_conversion_started`
- `experiment_idea_converted`
- `experiment_idea_conversion_failed`
- `experiment_idea_created_from_learning`

Never include title, description, hypothesis, rationale, custom-field free text, or Learning text in analytics payloads.

Useful initial measures:

- Organizations creating at least one Idea.
- Ideas and distinct contributors per active organization.
- Percentage of Ideas receiving additional details.
- Percentage converted to at least one Experiment.
- Median time from Idea creation to first Experiment.
- Percentage of linked Experiments retaining their source relationship.
- Percentage of Ideas informed by prior Learnings.
- Percentage of tested Ideas with a resulting Learning.

These are diagnostic measures, not targets for maximizing Idea volume or positive Experiment outcomes.

## MVP acceptance criteria

The MVP is complete when:

- A permitted user can create an Idea with a title and description.
- Applicable required custom fields are shown and validated.
- Ideas support organization-configured stages with stable IDs and an explicit default.
- Ideas can be listed, searched, filtered, viewed, edited, archived, and restored.
- All reads and writes enforce organization, project, role, entitlement, and linked-resource access.
- Owners, authors, tags, metrics, project, product area, structured details, custom fields, and prior Learnings persist correctly.
- A permitted user can review a prefilled form and create a linked draft Experiment.
- One Idea may create multiple Experiments.
- Conversion retries do not unintentionally create duplicates.
- Experiment and Idea pages link to each other.
- Derived Converted, Testing, Tested, and Learning available states are correct.
- Resulting supporting and contradicting Learnings appear without storing redundant reverse relationships.
- A user can create a new Idea from an accessible Learning.
- Ideas continue working when Learnings are unavailable.
- Audit events and privacy-safe product telemetry are recorded.
- The feature can be enabled incrementally.
- Legacy Idea records have not been destructively changed as part of the new implementation.

## Deferred work

- Voting and reactions.
- Impact, confidence, effort, or prioritization scoring.
- Kanban view.
- Campaigns, leaderboards, and rewards.
- Due dates, sprints, dependencies, or implementation-ticket management.
- Semantic duplicate detection.
- AI-generated ranking.
- Automatic experiment feasibility or sample-size analysis.
- External capture integrations.
- Autonomous code changes, experiment launches, or agent execution.
- Generalized polymorphic knowledge-item or relationship collections.

Revisit a generalized knowledge graph only if GrowthBook intentionally adds several more first-class knowledge resource types and needs unified permissions, search, and typed relationships across them.

## Rollout

1. Complete legacy code retirement without deleting stored data.
2. Enable the new feature for internal GrowthBook use.
3. Seed real Ideas across product, engineering, design, marketing, sales, and support.
4. Validate capture speed, stage customization, custom fields, permissions, conversion reliability, and Learning lineage.
5. Enable for a small set of design partners.
6. Review adoption, conversion behavior, search performance, custom-stage usage, and custom-field usage.
7. Expand availability only after workflow and isolation issues are resolved.

Do not add scoring or AI merely because initial Idea volume is low. First determine whether capture, ownership, stages, and conversion are understandable.
