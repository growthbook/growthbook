import { v4 as uuidv4 } from "uuid";
import isEqual from "lodash/isEqual";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import {
  CONTEXTUAL_BANDIT_MEASUREMENT_ARM_TYPE,
  MEASUREMENT_ARM_CB_GOVERNED_FIELDS,
  getContextualBanditMeasurementArmTrackingKey,
  isContextualBanditMeasurementArm,
  measurementArmWeights,
} from "shared/experiments";
import { generateVariationId, getSnapshotAnalysis } from "shared/util";
import {
  ContextualBanditInterface,
  ContextualBanditMeasurementArm,
  DEFAULT_MEASUREMENT_ARM_PERCENT,
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
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
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
}: {
  enabled?: boolean;
  percent?: number;
  existing?: ContextualBanditMeasurementArm;
  cbTrackingKey: string;
}): ContextualBanditMeasurementArm {
  return {
    enabled: enabled ?? existing?.enabled ?? true,
    percent: percent ?? existing?.percent ?? DEFAULT_MEASUREMENT_ARM_PERCENT,
    experimentId: existing?.experimentId,
    trackingKey:
      existing?.trackingKey ??
      getContextualBanditMeasurementArmTrackingKey(cbTrackingKey),
    seed: existing?.seed ?? uuidv4(),
  };
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
      "measurement_arm_locked: The measurement arm can only be changed while the contextual bandit is a draft",
    );
  }
}

async function resolveDefaultExposureQueryId(
  context: Context,
  cb: ContextualBanditInterface,
): Promise<string> {
  const [datasource, cbQuery] = await Promise.all([
    getDataSourceById(context, cb.datasource),
    cb.contextualBanditQueryId
      ? context.models.contextualBanditQueries.getById(
          cb.contextualBanditQueryId,
        )
      : Promise.resolve(null),
  ]);
  const exposureQueries = datasource?.settings?.queries?.exposure ?? [];
  const userIdType = cbQuery?.userIdType;
  if (!userIdType) return "";
  const builtIn = exposureQueries.find((q) => q.id === userIdType);
  if (builtIn) return "";
  const match = exposureQueries.find((q) => q.userIdType === userIdType);
  return match?.id ?? "";
}

function buildVariations(): Variation[] {
  return [
    {
      id: generateVariationId(),
      name: "Measurement arm",
      description: "Linked feature default value",
      key: "0",
      screenshots: [],
    },
    {
      id: generateVariationId(),
      name: "Contextual bandit",
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
  const exposureQueryId = await resolveDefaultExposureQueryId(context, cb);

  const data: Partial<ExperimentInterface> = {
    ...governed,
    organization: org.id,
    owner: cb.owner || userId || "",
    autoSnapshots: true,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    exposureQueryId,
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
 * was disabled on a draft, otherwise re-syncs governed fields.
 * Returns the CB patch to persist (experimentId set/cleared) or null.
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

  if (arm.enabled && arm.experimentId) {
    await syncMeasurementArmExperiment(context, cb);
  }
  return null;
}

const GOVERNED = new Set<string>(MEASUREMENT_ARM_CB_GOVERNED_FIELDS);

/** Throws when a caller tries to change a CB-governed field on a measurement-arm experiment. */
export function assertMeasurementArmExperimentEditable(
  experiment: ExperimentInterface,
  changes: Record<string, unknown>,
): void {
  if (!isContextualBanditMeasurementArm(experiment)) return;
  const blocked = Object.keys(changes).filter(
    (key) =>
      GOVERNED.has(key) &&
      // JSON round-trip so Date fields compare equal to their ISO strings
      // (UI payloads carry string dates).
      JSON.stringify(changes[key]) !==
        JSON.stringify(experiment[key as keyof ExperimentInterface]),
  );
  if (blocked.length) {
    throw new BadRequestError(
      `This experiment measures a contextual bandit; [${blocked.join(", ")}] can only be changed from the bandit`,
    );
  }
}

export function assertNotMeasurementArmExperiment(
  experiment: ExperimentInterface,
  action: string,
): void {
  if (isContextualBanditMeasurementArm(experiment)) {
    throw new BadRequestError(
      `Cannot ${action}: this experiment measures a contextual bandit and is managed from the bandit`,
    );
  }
}

export type MeasurementArmResultsSummary = {
  experimentId: string;
  trackingKey: string;
  percent: number;
  status: string;
  latestSnapshot: {
    id: string;
    dateCreated: string;
    status: "running" | "success" | "error";
    error?: string;
  } | null;
  decisionMetricResult: {
    metricId: string;
    controlMean: number | null;
    banditMean: number | null;
    controlUsers: number | null;
    banditUsers: number | null;
    lift: number | null;
    ci: [number | null, number | null] | null;
    chanceToWin: number | null;
    pValue: number | null;
  } | null;
};

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
