import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { getEqualWeights } from "shared/experiments";
import type { DeliveryMethod } from "@/components/Experiment/TabbedPage/ManagedValuesContext";

// The Setup page edits in place: every field on it writes into one local
// draft, and a single Save commits the lot. This file owns the draft's shape,
// how it's seeded from the experiment, and what a save sends.
//
// Fields split into two kinds:
//   - BACKED: a real experiment field exists, and Save writes it.
//   - STUBBED: the design shows a control with no field behind it in the
//     product today. It edits locally and is never sent. Marked below so a
//     demo never implies it persists.

export type StartMode = "manual" | "date";

// STUBBED. The experiment model has no end schedule
// (statusUpdateSchedule only carries startAt).
export type EndMode = "after" | "stopped" | "date";
export type EndUnit = "days" | "weeks";

// STUBBED. No product field for either decision outcome.
export type AtEndAction = "notify" | "ship-winner";
export type NoClearWinnerAction = "keep-running" | "ship-variation";

// Sequential testing's three-way choice, as in AnalysisForm: "default"
// follows the org setting; "on"/"off" override it.
export type SequentialMode = "default" | "on" | "off";

// The org's sequential testing defaults, needed to seed and save the
// "default" choice.
export interface SequentialDefaults {
  enabled: boolean;
  tuningParameter: number;
}

const NO_SEQUENTIAL_DEFAULTS: SequentialDefaults = {
  enabled: false,
  tuningParameter: DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
};

// A variation in the draft: what the draft can change about it. Its key,
// screenshots and weight come from the saved variation (or defaults, for an
// added one) when saved.
export interface DraftVariation {
  id: string;
  name: string;
  description: string;
}

export interface SetupDraft {
  // Backed
  hypothesis: string;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  startMode: StartMode;
  startAt: string | null;
  decisionCriteriaId: string | null;
  // Backed: per-metric Target MDE overrides, metric id to a fraction (0.1 is
  // 10%), edited from a goal metric's popover. Saved as
  // decisionFrameworkSettings.decisionFrameworkMetricOverrides, the field the
  // Edit Target MDEs modal writes. A metric with no entry uses its default.
  targetMDEOverrides: Record<string, number>;
  // Backed, in the Analysis Plan's Advanced section. Same semantics as
  // AnalysisForm: statsEngine "" means the org/project default;
  // postStratificationEnabled null means the default.
  statsEngine: "" | "bayesian" | "frequentist";
  regressionAdjustmentEnabled: boolean;
  postStratificationEnabled: boolean | null;
  sequentialMode: SequentialMode;
  sequentialTuningParameter: number;
  // Backed, in Implementation's Population card: the latest phase's
  // coverage, 0 to 1 (shown as a percentage). The experiment endpoint sets it
  // on the latest phase.
  coverage: number;
  // Backed, by the Setup page's own save (not buildSavePayload): the
  // variations as the draft has them, in order (set in review). Dragging a
  // card's colour band reorders them, the Implementation section's "+" adds
  // one (with a new id), and a variation's own modal renames, re-describes
  // or deletes it. Saving sends the variations and their weights.
  variations: DraftVariation[];
  // Backed, by the Setup page's own save: the traffic split, each saved
  // variation's weight (a fraction, 0.5 is 50%) by id, as the Edit Split %
  // modal sets it (set in review). Added or deleted variations take their
  // weights from it by the modal's rules (see draftWeights).
  splitWeights: Record<string, number>;
  // Backed, from the Details rail's modals (set in review: they apply here
  // and the save bar saves them, rather than each saving on its own).
  description: string;
  project: string;
  tags: string[];
  // Backed, from the rail's Edit Data Source modal: the data source, its
  // assignment query and the experiment key.
  datasource: string;
  exposureQueryId: string;
  trackingKey: string;
  // Backed: what Edit Data Source cleared because the new data source can't
  // use it (the segment, the activation metric), sent last on save so the
  // Advanced section's own copy of those can't put the old ones back.
  // Empty when nothing was cleared.
  dataSourceResets: { segment?: string; activationMetric?: string };
  // PROTOTYPE, front-end only: the delivery type from the rail's Change
  // Experiment Type modal. Never sent to the API; Save sets it in this
  // browser (ManagedValuesContext) as the modal used to.
  deliveryType: DeliveryMethod;
  // Stubbed: never sent on save
  endMode: EndMode;
  endAfter: number;
  endUnit: EndUnit;
  endAt: string | null;
  atEnd: AtEndAction;
  noClearWinner: NoClearWinnerAction;
  noClearWinnerVariationId: string | null;
}

export const STUBBED_FIELDS = [
  "endMode",
  "endAfter",
  "endUnit",
  "endAt",
  "atEnd",
  "noClearWinner",
  "noClearWinnerVariationId",
] as const satisfies readonly (keyof SetupDraft)[];

// The latest phase's weights by variation id (in the phase's variation
// order, which the weights follow), or an even split when it has none.
function splitWeightsFromExperiment(
  experiment: Partial<
    Pick<ExperimentInterfaceStringDates, "phases" | "variations">
  >,
): Record<string, number> {
  const phase = experiment.phases?.[experiment.phases.length - 1];
  const ids = phase?.variations?.length
    ? phase.variations.map((v) => v.id)
    : (experiment.variations ?? []).map((v) => v.id);
  const weights = phase?.variationWeights ?? [];
  const even = ids.length ? getEqualWeights(ids.length) : [];
  return Object.fromEntries(
    ids.map((id, i) => [id, weights[i] ?? even[i] ?? 0]),
  );
}

export function draftFromExperiment(
  experiment: Pick<
    ExperimentInterfaceStringDates,
    | "hypothesis"
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "statusUpdateSchedule"
    | "decisionFrameworkSettings"
    | "statsEngine"
    | "regressionAdjustmentEnabled"
    | "postStratificationEnabled"
    | "sequentialTestingEnabled"
    | "sequentialTestingTuningParameter"
  > &
    Partial<
      Pick<
        ExperimentInterfaceStringDates,
        | "phases"
        | "variations"
        | "description"
        | "project"
        | "tags"
        | "datasource"
        | "exposureQueryId"
        | "trackingKey"
      >
    >,
  sequentialDefaults: SequentialDefaults = NO_SEQUENTIAL_DEFAULTS,
  // The experiment's delivery type (prototype; see deliveryType above).
  deliveryType: DeliveryMethod = "values",
): SetupDraft {
  const startAt = experiment.statusUpdateSchedule?.startAt ?? null;
  // Same rule as AnalysisForm: a migration makes sequentialTestingEnabled a
  // boolean on every experiment, so "never set" can't be told apart from
  // "set to the default". Values matching the org default read as Default.
  const seqEnabled = experiment.sequentialTestingEnabled ?? false;
  const seqTuning =
    experiment.sequentialTestingTuningParameter ??
    sequentialDefaults.tuningParameter;
  const sequentialMode: SequentialMode =
    seqEnabled === sequentialDefaults.enabled &&
    seqTuning === sequentialDefaults.tuningParameter
      ? "default"
      : seqEnabled
        ? "on"
        : "off";
  return {
    hypothesis: experiment.hypothesis ?? "",
    goalMetrics: [...(experiment.goalMetrics ?? [])],
    secondaryMetrics: [...(experiment.secondaryMetrics ?? [])],
    guardrailMetrics: [...(experiment.guardrailMetrics ?? [])],
    startMode: startAt ? "date" : "manual",
    startAt: startAt ? new Date(startAt).toISOString() : null,
    decisionCriteriaId:
      experiment.decisionFrameworkSettings?.decisionCriteriaId ?? null,
    targetMDEOverrides: Object.fromEntries(
      (
        experiment.decisionFrameworkSettings
          ?.decisionFrameworkMetricOverrides ?? []
      )
        .filter((o) => o.targetMDE !== undefined)
        .map((o) => [o.id, o.targetMDE as number]),
    ),
    statsEngine: experiment.statsEngine ?? "",
    regressionAdjustmentEnabled: !!experiment.regressionAdjustmentEnabled,
    postStratificationEnabled: experiment.postStratificationEnabled ?? null,
    sequentialMode,
    sequentialTuningParameter: seqTuning,
    coverage: experiment.phases?.[experiment.phases.length - 1]?.coverage ?? 1,
    splitWeights: splitWeightsFromExperiment(experiment),
    variations: (experiment.variations ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description ?? "",
    })),
    description: experiment.description ?? "",
    project: experiment.project ?? "",
    tags: [...(experiment.tags ?? [])],
    datasource: experiment.datasource ?? "",
    exposureQueryId: experiment.exposureQueryId ?? "",
    trackingKey: experiment.trackingKey ?? "",
    dataSourceResets: {},
    deliveryType,
    endMode: "after",
    endAfter: 14,
    endUnit: "days",
    endAt: null,
    atEnd: "notify",
    noClearWinner: "keep-running",
    noClearWinnerVariationId: null,
  };
}

function sameList<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameOverrides(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
  );
}

// Which fields differ. Metric order is meaningful (it's the display order), so
// lists compare in order.
export function changedFields(
  base: SetupDraft,
  draft: SetupDraft,
): (keyof SetupDraft)[] {
  return (Object.keys(draft) as (keyof SetupDraft)[]).filter((key) => {
    const a = base[key];
    const b = draft[key];
    if (key === "variations")
      return (
        JSON.stringify(base.variations) !== JSON.stringify(draft.variations)
      );
    if (key === "targetMDEOverrides")
      return !sameOverrides(base.targetMDEOverrides, draft.targetMDEOverrides);
    if (key === "splitWeights")
      return !sameOverrides(base.splitWeights, draft.splitWeights);
    if (key !== "tags" && Array.isArray(a) && Array.isArray(b))
      return !sameList<unknown>(a, b);
    // Tags: the same tags in another order aren't a change.
    if (key === "tags")
      return (
        base.tags.length !== draft.tags.length ||
        draft.tags.some((t) => !base.tags.includes(t))
      );
    if (key === "dataSourceResets")
      return (
        JSON.stringify(base.dataSourceResets) !==
        JSON.stringify(draft.dataSourceResets)
      );
    return a !== b;
  });
}

// What Save sends. Only backed fields that changed, so a save never rewrites
// a field the user didn't touch. Stubbed fields are dropped here — this is the
// one place that guarantees they never reach the API.
export function buildSavePayload(
  base: SetupDraft,
  draft: SetupDraft,
  existingDecisionFrameworkSettings?: ExperimentInterfaceStringDates["decisionFrameworkSettings"],
  sequentialDefaults: SequentialDefaults = NO_SEQUENTIAL_DEFAULTS,
): Record<string, unknown> {
  const changed = new Set(changedFields(base, draft));
  const payload: Record<string, unknown> = {};

  if (changed.has("hypothesis")) payload.hypothesis = draft.hypothesis;
  if (changed.has("goalMetrics")) payload.goalMetrics = draft.goalMetrics;
  if (changed.has("secondaryMetrics"))
    payload.secondaryMetrics = draft.secondaryMetrics;
  if (changed.has("guardrailMetrics"))
    payload.guardrailMetrics = draft.guardrailMetrics;

  if (changed.has("startMode") || changed.has("startAt")) {
    // "On date" with no date picked yet is not a schedule; treat as manual
    // rather than sending an empty startAt.
    payload.statusUpdateSchedule =
      draft.startMode === "date" && draft.startAt
        ? { startAt: draft.startAt }
        : null;
  }

  // One object holds both, so either change sends it whole, starting from
  // what's saved. Each part only replaces the saved one when it's the part
  // that changed: changing just the criteria keeps the saved overrides,
  // even ones set elsewhere since the page loaded (and the other way round).
  if (changed.has("decisionCriteriaId") || changed.has("targetMDEOverrides")) {
    payload.decisionFrameworkSettings = {
      ...existingDecisionFrameworkSettings,
      ...(changed.has("decisionCriteriaId")
        ? { decisionCriteriaId: draft.decisionCriteriaId ?? undefined }
        : {}),
      ...(changed.has("targetMDEOverrides")
        ? {
            decisionFrameworkMetricOverrides: Object.entries(
              draft.targetMDEOverrides,
            ).map(([id, targetMDE]) => ({ id, targetMDE })),
          }
        : {}),
    };
  }

  if (changed.has("coverage")) payload.coverage = draft.coverage;

  // The Details rail's fields (description, project, tags, and the data
  // source group). dataSourceResets and deliveryType aren't sent here: the
  // Setup page sends the resets last, and the type never reaches the API.
  if (changed.has("description")) payload.description = draft.description;
  if (changed.has("project")) payload.project = draft.project;
  if (changed.has("tags")) payload.tags = draft.tags;
  if (changed.has("datasource")) payload.datasource = draft.datasource;
  if (changed.has("exposureQueryId"))
    payload.exposureQueryId = draft.exposureQueryId;
  if (changed.has("trackingKey")) payload.trackingKey = draft.trackingKey;

  // Stats settings, sent the way AnalysisForm sends them.
  if (changed.has("statsEngine")) payload.statsEngine = draft.statsEngine;
  if (changed.has("regressionAdjustmentEnabled"))
    payload.regressionAdjustmentEnabled = draft.regressionAdjustmentEnabled;
  if (changed.has("postStratificationEnabled"))
    payload.postStratificationEnabled = draft.postStratificationEnabled;
  if (
    changed.has("sequentialMode") ||
    changed.has("sequentialTuningParameter")
  ) {
    if (draft.sequentialMode === "default") {
      payload.sequentialTestingEnabled = sequentialDefaults.enabled;
      payload.sequentialTestingTuningParameter =
        sequentialDefaults.tuningParameter;
    } else {
      payload.sequentialTestingEnabled = draft.sequentialMode === "on";
      payload.sequentialTestingTuningParameter =
        draft.sequentialTuningParameter;
    }
  }

  return payload;
}

export type StubbedPart = Pick<SetupDraft, (typeof STUBBED_FIELDS)[number]>;

export function pickStubbed(draft: SetupDraft): StubbedPart {
  const out = {} as Record<string, unknown>;
  STUBBED_FIELDS.forEach((key) => {
    out[key] = draft[key];
  });
  return out as StubbedPart;
}

// When the baseline moves under an open draft (a save, or an edit made
// elsewhere on the page, such as a modal), keep the user's unsaved edits and
// take the new baseline everywhere else. A field counts as edited if it
// differs from the baseline the draft was started from.
export function rebaseDraft(
  oldBase: SetupDraft,
  newBase: SetupDraft,
  draft: SetupDraft,
): SetupDraft {
  const edited = new Set(changedFields(oldBase, draft));
  const out = { ...newBase } as Record<string, unknown>;
  (Object.keys(draft) as (keyof SetupDraft)[]).forEach((key) => {
    if (edited.has(key)) out[key] = draft[key];
  });
  return out as unknown as SetupDraft;
}

// The variations' weights in a draft order, which may include unsaved added
// variations, as the Edit Traffic & Variations modal would set them: an
// equal split stays equal across all of them; otherwise each saved
// variation keeps its weight and an added one starts at 0.
export function draftVariationWeights(
  savedIds: string[],
  savedWeights: number[],
  order: string[],
): number[] {
  const weights = savedWeights.length
    ? savedWeights
    : savedIds.map(() => 1 / Math.max(savedIds.length, 1));
  const isEqual = weights.every((w) => Math.abs(w - weights[0]) < 0.0001);
  if (isEqual) return getEqualWeights(order.length);
  const kept = order.map((id) => {
    const i = savedIds.indexOf(id);
    return i === -1 ? 0 : (weights[i] ?? 0);
  });
  // A deleted variation's share goes to the rest, in proportion.
  const total = kept.reduce((a, b) => a + b, 0);
  return total > 0 && Math.abs(total - 1) > 0.0001
    ? kept.map((w) => w / total)
    : kept;
}

// The draft's weights in its variation order: the split's own weight for
// each variation it has, and the modal's rules for any added since
// (draftVariationWeights).
export function draftWeights(draft: SetupDraft): number[] {
  return draftVariationWeights(
    Object.keys(draft.splitWeights),
    Object.values(draft.splitWeights),
    draft.variations.map((v) => v.id),
  );
}
