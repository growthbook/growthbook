import { ApiContextualBanditInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";

/**
 * Project an `ApiContextualBanditInterface` (PR-4 API shape) into the
 * `ExperimentInterfaceStringDates` shape that all the legacy
 * experiment-aware components consume: `TabbedPage`, `SnapshotProvider`,
 * `EditMetricsForm`, `StopExperimentForm`, `EditVariationsForm`,
 * `EditTagsForm`, `EditProjectForm`, `NewPhaseForm`, `EditPhaseModal`,
 * `EditPhasesModal`, `EditTargetingModal`, and the various tab bodies
 * under `components/Experiment/TabbedPage/*`.
 *
 * Why this exists (and why it's transitional)
 * -------------------------------------------
 *
 * The CB list page (PR-6) was forkable in isolation because it only
 * reads CB-shaped data. The CB *detail* page is heavier — it passes a
 * CB doc to ~10 edit modals + a complex tab tree that all take
 * `ExperimentInterfaceStringDates` and call `/experiment/${id}`
 * endpoints. Forking each of those components is a bigger
 * cross-cutting change.
 *
 * This projection gives the detail-page fork a path forward without
 * needing to fork every experiment-shaped component up front: fetch
 * the CB via `useContextualBandit`, project to experiment shape via
 * this helper, and continue passing it to the existing components.
 * Writes continue to flow through `/experiment/${id}` during the
 * transition window — the CB's `experiment` FK keeps both stores in
 * sync until PR-8 drops the FK and migrates writes onto the CB-native
 * `PUT /api/v1/contextual-bandits/:id` (already wired in PR-4 CRUD).
 *
 * Fields where the projection has to fill blanks
 * ----------------------------------------------
 *
 * CB doesn't carry:
 *   - `hasVisualChangesets`, `hasURLRedirects` (CB doesn't support
 *     visual edits or URL redirects yet — both default to `false`).
 *   - `results`, `releasedVariationId`, `winner` (no decision framework
 *     yet — defaults / undefined).
 *   - `analysisSummary` (CB results UI consumes the snapshot directly).
 *   - `decisionCriteriaId` / `decisionFrameworkSettings` (deferred to v1.5).
 *   - `dismissedWarnings` (CB doesn't emit warnings in v1).
 *   - Experiment-phase metadata (`name`, `reason`, `savedGroups`,
 *     `prerequisites`, `namespace`, `banditEvents`) — defaulted from
 *     the corresponding CB phase fields where possible.
 *
 * Drop once PR-6's `TabbedPage` accepts a CB shape directly.
 */
export function contextualBanditToExperimentShape(
  cb: ApiContextualBanditInterface,
  org: { id: string },
): ExperimentInterfaceStringDates {
  return {
    id: cb.id,
    organization: org.id,
    dateCreated: cb.dateCreated,
    dateUpdated: cb.dateUpdated,
    name: cb.name,
    description: cb.description,
    hypothesis: cb.hypothesis,
    project: cb.project,
    owner: cb.owner,
    tags: cb.tags,
    archived: cb.archived,
    customFields: cb.customFields,
    status: cb.status,
    trackingKey: cb.trackingKey,
    hashAttribute: cb.hashAttribute,
    fallbackAttribute: cb.fallbackAttribute,
    hashVersion: cb.hashVersion,
    disableStickyBucketing: cb.disableStickyBucketing,
    variations: cb.variations,
    phases: cb.phases.map((p) => ({
      dateStarted: p.dateStarted,
      dateEnded: p.dateEnded ?? undefined,
      name: "Main",
      reason: "",
      coverage: p.coverage ?? 1,
      condition: p.condition ?? "",
      variationWeights: p.variationWeights ?? cb.variations.map(() => 1),
      variations: cb.variations.map((v) => ({ id: v.id })),
      seed: p.seed,
    })),
    datasource: cb.datasource,
    exposureQueryId: cb.exposureQueryId,
    segment: cb.segment,
    queryFilter: cb.queryFilter,
    goalMetrics: cb.goalMetrics,
    secondaryMetrics: cb.secondaryMetrics,
    guardrailMetrics: cb.guardrailMetrics,
    activationMetric: cb.activationMetric,
    attributionModel: cb.attributionModel,
    skipPartialData: cb.skipPartialData,
    regressionAdjustmentEnabled: cb.regressionAdjustmentEnabled,
    type: "contextual-bandit",
    implementation: "code",
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    releasedVariationId: "",
    autoSnapshots: false,
    hasVisualChangesets: false,
    hasURLRedirects: false,
    linkedFeatures: [],
  } as unknown as ExperimentInterfaceStringDates;
}
