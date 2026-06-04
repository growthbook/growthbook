import { ApiContextualBanditInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";

/** Runtime marker flagging a synthesized experiment as CB-backed; use `isContextualBanditExperiment` to gate. */
export const CB_AS_EXPERIMENT_TYPE = "contextual-bandit" as const;

export function isContextualBanditExperiment(
  experiment: { type?: string | null } | null | undefined,
): boolean {
  return (
    !!experiment &&
    "type" in experiment &&
    (experiment.type as string | null | undefined) === CB_AS_EXPERIMENT_TYPE
  );
}

/** Transitional adapter: project a CB API doc to the experiment shape legacy components expect. */
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
    // CB API omits `screenshots`; default to [] so experiment-shape consumers don't throw.
    variations: cb.variations.map((v) => ({ ...v, screenshots: [] })),
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
    type: CB_AS_EXPERIMENT_TYPE,
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
