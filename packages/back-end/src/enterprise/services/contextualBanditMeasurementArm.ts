import { v4 as uuidv4 } from "uuid";
import isEqual from "lodash/isEqual";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import {
  CONTEXTUAL_BANDIT_MEASUREMENT_ARM_TYPE,
  MEASUREMENT_ARM_EDITABLE_FIELDS,
  getContextualBanditMeasurementArmTrackingKey,
  isContextualBanditMeasurementArm,
  measurementArmWeights,
} from "shared/experiments";
import { generateVariationId, getSnapshotAnalysis } from "shared/util";
import {
  ContextualBanditInterface,
  ContextualBanditMeasurementArm,
  ContextualBanditMeasurementArmSummary,
  DEFAULT_MEASUREMENT_ARM_PERCENT,
  MAX_MEASUREMENT_ARM_PERCENT,
  MIN_MEASUREMENT_ARM_PERCENT,
} from "shared/validators";
import {
  ExperimentInterface,
  ExperimentPhase,
  Variation,
} from "shared/types/experiment";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  getLatestSnapshotStatus,
  getLatestSuccessfulSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { BadRequestError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

type Context = ReqContext | ApiReqContext;

export function buildMeasurementArmSubdoc({
  enabled,
  percent,
  existing,
  cbTrackingKey,
  rederiveTrackingKey,
}: {
  enabled?: boolean;
  percent?: number;
  existing?: ContextualBanditMeasurementArm;
  cbTrackingKey: string;
  rederiveTrackingKey?: boolean;
}): ContextualBanditMeasurementArm {
  const resolvedEnabled = enabled ?? existing?.enabled ?? false;
  let resolvedPercent =
    percent ?? existing?.percent ?? DEFAULT_MEASUREMENT_ARM_PERCENT;
  if (resolvedPercent < MIN_MEASUREMENT_ARM_PERCENT) {
    if (resolvedEnabled) {
      throw new BadRequestError(
        `measurement_arm_percent: The measurement arm must hold back between ${MIN_MEASUREMENT_ARM_PERCENT * 100}% and ${MAX_MEASUREMENT_ARM_PERCENT * 100}% of traffic, or be disabled`,
      );
    }
    resolvedPercent = existing?.percent ?? DEFAULT_MEASUREMENT_ARM_PERCENT;
  }
  return {
    enabled: resolvedEnabled,
    percent: resolvedPercent,
    experimentId: existing?.experimentId,
    trackingKey:
      !rederiveTrackingKey && existing?.trackingKey
        ? existing.trackingKey
        : getContextualBanditMeasurementArmTrackingKey(cbTrackingKey),
    seed: existing?.seed ?? uuidv4(),
  };
}

const MEASUREMENT_ARM_SYNC_CB_FIELDS = [
  "name",
  "description",
  "tags",
  "project",
  "owner",
  "hashAttribute",
  "trackingKey",
  "datasource",
  "decisionMetric",
  "status",
  "archived",
  "dateStarted",
  "dateStopped",
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
  "measurementArm",
] as const satisfies readonly (keyof ContextualBanditInterface)[];

export function measurementArmSyncFieldsChanged(
  before: ContextualBanditInterface,
  after: ContextualBanditInterface,
): boolean {
  return MEASUREMENT_ARM_SYNC_CB_FIELDS.some(
    (field) => !isEqual(before[field], after[field]),
  );
}

export function measurementArmIsActive(
  cb: Pick<ContextualBanditInterface, "measurementArm" | "status">,
): boolean {
  return !!(
    cb.measurementArm?.enabled &&
    cb.measurementArm.experimentId &&
    cb.status === "running"
  );
}

export function assertMeasurementArmChangeAllowed(
  existing: ContextualBanditInterface,
  updated: Partial<
    Pick<ContextualBanditInterface, "measurementArm" | "status">
  >,
): void {
  if (!updated.measurementArm) return;
  const before = existing.measurementArm;
  const after = updated.measurementArm;
  const changed =
    before?.enabled !== after.enabled || before?.percent !== after.percent;
  if (!changed) return;
  if (existing.status !== "draft") {
    throw new BadRequestError(
      "measurement_arm_locked: The measurement arm can only be changed while the Contextual Bandit is a draft",
    );
  }
}

function buildVariations(): Variation[] {
  return [
    {
      id: generateVariationId(),
      name: "Measurement arm",
      description:
        "Default experience: linked feature default values, no visual changes",
      key: "0",
      screenshots: [],
    },
    {
      id: generateVariationId(),
      name: "Contextual Bandit",
      description: "",
      key: "1",
      screenshots: [],
    },
  ];
}

function buildPhase(
  cb: ContextualBanditInterface,
  arm: ContextualBanditMeasurementArm,
  variations: Variation[],
  existing?: ExperimentPhase,
): ExperimentPhase {
  const phase: ExperimentPhase = {
    name: "Main",
    reason: "",
    dateStarted: cb.dateStarted ?? existing?.dateStarted ?? new Date(),
    coverage: cb.coverage ?? 1,
    condition: cb.condition ?? "",
    variationWeights: measurementArmWeights(arm.percent),
    seed: arm.seed,
    variations: variations.map((v) => ({
      id: v.id,
      status: "active" as const,
    })),
  };
  // Only set optional keys when present so an unchanged phase compares equal
  // on re-sync (lodash isEqual treats an explicit undefined as a difference).
  const dateEnded = cb.dateStopped ?? existing?.dateEnded;
  if (dateEnded) phase.dateEnded = dateEnded;
  if (cb.savedGroups?.length) phase.savedGroups = cb.savedGroups;
  if (cb.prerequisites?.length) phase.prerequisites = cb.prerequisites;
  return phase;
}

function cbGovernedChanges(
  cb: ContextualBanditInterface,
  arm: ContextualBanditMeasurementArm,
  experiment?: ExperimentInterface,
): Partial<ExperimentInterface> {
  const variations = experiment?.variations?.length
    ? experiment.variations
    : buildVariations();
  return {
    name: `${cb.name} — measurement arm`,
    description: cb.description ?? "",
    tags: cb.tags ?? [],
    project: cb.project ?? "",
    owner: cb.owner ?? "",
    hashAttribute: cb.hashAttribute || "id",
    fallbackAttribute: "",
    hashVersion: 2,
    disableStickyBucketing: true,
    trackingKey:
      arm.trackingKey ??
      getContextualBanditMeasurementArmTrackingKey(cb.trackingKey),
    datasource: cb.datasource,
    exposureQueryId: "",
    goalMetrics: cb.decisionMetric ? [cb.decisionMetric] : [],
    variations,
    phases: [buildPhase(cb, arm, variations, experiment?.phases?.[0])],
    status: cb.status,
    archived: cb.archived,
    excludeFromPayload: true,
    type: CONTEXTUAL_BANDIT_MEASUREMENT_ARM_TYPE,
    contextualBanditId: cb.id,
    hasVisualChangesets: false,
    hasURLRedirects: false,
  };
}

export async function createMeasurementArmExperiment(
  context: Context,
  cb: ContextualBanditInterface,
  arm: ContextualBanditMeasurementArm,
): Promise<ExperimentInterface> {
  const { org, userId } = context;
  const governed = cbGovernedChanges(cb, arm);

  const data: Partial<ExperimentInterface> = {
    ...governed,
    organization: org.id,
    owner: cb.owner || userId || "",
    autoSnapshots: true,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    userIdType: "anonymous",
    hypothesis: "",
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: "",
    metricOverrides: [],
    segment: "",
    queryFilter: "",
    skipPartialData: false,
    attributionModel: "firstExposure",
    implementation: "code",
    results: undefined,
    analysis: "",
    releasedVariationId: "",
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    sequentialTestingEnabled: false,
    sequentialTestingTuningParameter:
      org?.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    regressionAdjustmentEnabled: false,
    customFields: {},
    shareLevel: "organization",
    decisionFrameworkSettings: {},
  };

  return createExperiment({ data, context });
}

/** Re-syncs every CB-governed field onto the wrapper experiment. No-op when nothing changed. */
export async function syncMeasurementArmExperiment(
  context: Context,
  cb: ContextualBanditInterface,
): Promise<ExperimentInterface | null> {
  const arm = cb.measurementArm;
  if (!arm?.experimentId) return null;
  const experiment = await getExperimentById(context, arm.experimentId);
  if (!experiment) {
    logger.warn(
      { cbId: cb.id, experimentId: arm.experimentId },
      "Measurement arm experiment missing; skipping sync",
    );
    return null;
  }
  const governed = cbGovernedChanges(cb, arm, experiment);
  const changes: Partial<ExperimentInterface> = {};
  for (const key of Object.keys(governed) as (keyof ExperimentInterface)[]) {
    if (!isEqual(governed[key], experiment[key])) {
      (changes as Record<string, unknown>)[key] = governed[key];
    }
  }
  if (Object.keys(changes).length === 0) return experiment;
  return updateExperiment({
    context,
    experiment,
    changes,
    bypassWebhooks: true,
  });
}

export async function deleteMeasurementArmExperiment(
  context: Context,
  experimentId: string,
): Promise<void> {
  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) return;
  await deleteExperimentByIdForOrganization(context, experiment);
}

/**
 * Reconciles the wrapper experiment with the CB doc after a create or update:
 * creates it when the arm was just enabled on a draft, deletes it when the arm
 * was disabled on a draft. Governed-field sync happens in the model's
 * afterUpdate hook. Returns the CB patch to persist (experimentId set/cleared)
 * or null.
 */
export async function reconcileMeasurementArmExperiment(
  context: Context,
  cb: ContextualBanditInterface,
): Promise<Pick<ContextualBanditInterface, "measurementArm"> | null> {
  const arm = cb.measurementArm;
  if (!arm) return null;

  if (arm.enabled && !arm.experimentId) {
    const experiment = await createMeasurementArmExperiment(context, cb, arm);
    return {
      measurementArm: {
        ...arm,
        experimentId: experiment.id,
        trackingKey: experiment.trackingKey,
      },
    };
  }

  if (!arm.enabled && arm.experimentId) {
    await deleteMeasurementArmExperiment(context, arm.experimentId);
    return {
      measurementArm: { ...arm, experimentId: undefined },
    };
  }

  return null;
}

const EDITABLE = new Set<string>(MEASUREMENT_ARM_EDITABLE_FIELDS);

/** Only secondary and guardrail metrics may change on a measurement-arm experiment. */
export function assertMeasurementArmExperimentEditable(
  experiment: ExperimentInterface,
  changes: Record<string, unknown>,
): void {
  if (!isContextualBanditMeasurementArm(experiment)) return;
  const normalize = (v: unknown) =>
    v === undefined || v === "" || (Array.isArray(v) && v.length === 0)
      ? null
      : JSON.stringify(v);
  const blocked = Object.keys(changes).filter((key) => {
    if (EDITABLE.has(key)) return false;
    const value = changes[key];
    if (value === undefined) return false;
    return (
      normalize(value) !==
      normalize(experiment[key as keyof ExperimentInterface])
    );
  });
  if (blocked.length) {
    throw new BadRequestError(
      `Only secondary and guardrail metrics can be changed on a measurement arm; [${blocked.join(", ")}] follow the Contextual Bandit`,
    );
  }
}

export function assertNotMeasurementArmExperiment(
  experiment: ExperimentInterface,
  action: string,
): void {
  if (isContextualBanditMeasurementArm(experiment)) {
    throw new BadRequestError(
      `Cannot ${action}: this experiment measures a Contextual Bandit and is managed from the Bandit`,
    );
  }
}

export type MeasurementArmResultsSummary =
  ContextualBanditMeasurementArmSummary;

/** The one-line comparison the CB Results tab shows; full results live on the experiment. */
export async function getMeasurementArmResultsSummary(
  context: Context,
  cb: ContextualBanditInterface,
): Promise<MeasurementArmResultsSummary | null> {
  const arm = cb.measurementArm;
  if (!arm?.enabled || !arm.experimentId) return null;
  const experiment = await getExperimentById(context, arm.experimentId);
  if (!experiment) return null;
  const phase = Math.max(0, experiment.phases.length - 1);

  const [status, snapshot] = await Promise.all([
    getLatestSnapshotStatus({
      context,
      experiment: experiment.id,
      phase,
      type: "standard",
    }),
    getLatestSuccessfulSnapshot({
      context,
      experiment: experiment.id,
      phase,
      type: "standard",
    }),
  ]);

  const metricId = experiment.goalMetrics?.[0] ?? cb.decisionMetric ?? "";
  const analysis = snapshot ? getSnapshotAnalysis(snapshot) : null;
  const variations = analysis?.results?.[0]?.variations ?? [];
  const control = variations[0];
  const bandit = variations[1];
  const banditMetric = metricId ? bandit?.metrics?.[metricId] : undefined;
  const controlMetric = metricId ? control?.metrics?.[metricId] : undefined;

  return {
    experimentId: experiment.id,
    trackingKey: experiment.trackingKey,
    percent: arm.percent,
    status: experiment.status,
    latestSnapshot: status
      ? {
          id: status.id,
          dateCreated: status.dateCreated.toISOString(),
          status: status.status,
          error: status.error,
        }
      : null,
    resultsSnapshot: snapshot
      ? { id: snapshot.id, dateCreated: snapshot.dateCreated.toISOString() }
      : null,
    decisionMetricResult:
      metricId && (banditMetric || controlMetric)
        ? {
            metricId,
            controlMean: controlMetric?.cr ?? null,
            banditMean: banditMetric?.cr ?? null,
            controlUsers: control?.users ?? null,
            banditUsers: bandit?.users ?? null,
            lift: banditMetric?.expected ?? null,
            ci: banditMetric?.ci
              ? [banditMetric.ci[0] ?? null, banditMetric.ci[1] ?? null]
              : null,
            chanceToWin: banditMetric?.chanceToWin ?? null,
            pValue: banditMetric?.pValue ?? null,
          }
        : null,
  };
}
