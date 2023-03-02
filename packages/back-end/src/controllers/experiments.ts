import { Response } from "express";
import uniqid from "uniqid";
import format from "date-fns/format";
import cloneDeep from "lodash/cloneDeep";
import { AuthRequest, ResponseWithStatusAndError } from "../types/AuthRequest";
import {
  createManualSnapshot,
  createSnapshot,
  ensureWatching,
  experimentUpdated,
  getExperimentWatchers,
  getManualSnapshotData,
  processPastExperiments,
} from "../services/experiments";
import { MetricStats } from "../../types/metric";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  getAllExperiments,
  getExperimentById,
  getExperimentByTrackingKey,
  getPastExperimentsByDatasource,
  logExperimentUpdated,
  updateExperimentById,
} from "../models/ExperimentModel";
import {
  deleteSnapshotById,
  findSnapshotById,
  updateSnapshot,
  updateSnapshotsOnPhaseDelete,
  getLatestSnapshot,
} from "../models/ExperimentSnapshotModel";
import { getSourceIntegrationObject } from "../services/datasource";
import { addTagsDiff } from "../models/TagModel";
import { getOrgFromReq, userHasAccess } from "../services/organizations";
import { removeExperimentFromPresentations } from "../services/presentations";
import {
  cancelRun,
  getPastExperiments,
  getStatusEndpoint,
  startRun,
} from "../services/queries";
import { PastExperimentsModel } from "../models/PastExperimentsModel";
import {
  Changeset,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
  ExperimentStatus,
  Variation,
} from "../../types/experiment";
import { getMetricById } from "../models/MetricModel";
import { IdeaModel } from "../models/IdeasModel";
import { IdeaInterface } from "../../types/idea";
import { getDataSourceById } from "../models/DataSourceModel";
import { generateExperimentNotebook } from "../services/notebook";
import { analyzeExperimentResults } from "../services/stats";
import { getValidDate } from "../util/dates";
import { getReportVariations } from "../services/reports";
import { IMPORT_LIMIT_DAYS } from "../util/secrets";
import { getAllFeatures } from "../models/FeatureModel";
import { ExperimentRule, FeatureInterface } from "../../types/feature";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../services/audit";
import { logger } from "../util/logger";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";

export async function getExperiments(
  req: AuthRequest<
    unknown,
    unknown,
    {
      project?: string;
    }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const experiments = await getAllExperiments(org.id, project);

  res.status(200).json({
    status: 200,
    experiments,
  });
}

export async function getExperimentsFrequencyMonth(
  req: AuthRequest<null, { num: string }, { project?: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const { num } = req.params;
  const experiments = await getAllExperiments(org.id, project);

  const allData: { date: string; numExp: number }[] = [];

  // make the data array with all the months needed and 0 experiments.
  for (let i = parseInt(num) - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(1); // necessary because altering the month may result in an invalid date (ex: Feb 31)
    d.setMonth(d.getMonth() - i);
    const ob = {
      date: d.toISOString(),
      numExp: 0,
    };
    allData.push(ob);
  }

  // create stubs for each month by all the statuses:
  const dataByStatus = {
    draft: JSON.parse(JSON.stringify(allData)),
    running: JSON.parse(JSON.stringify(allData)),
    stopped: JSON.parse(JSON.stringify(allData)),
  };

  // now get the right number of experiments:
  experiments.forEach((e) => {
    let dateStarted: Date | null = null;
    if (e.status === "draft") {
      dateStarted = e.dateCreated;
    } else {
      e.phases.forEach((p) => {
        if (p.dateStarted && (!dateStarted || p.dateStarted < dateStarted))
          dateStarted = p.dateStarted;
      });
    }
    const monthYear = format(getValidDate(dateStarted), "MMM yyy");

    allData.forEach((md, i) => {
      const name = format(getValidDate(md.date), "MMM yyy");
      if (name === monthYear) {
        md.numExp++;
        // I can do this because the indexes will represent the same month
        dataByStatus[e.status][i].numExp++;
      }
    });
  });

  res.status(200).json({
    status: 200,
    data: { all: allData, ...dataByStatus },
  });
}

export async function lookupExperimentByTrackingKey(
  req: AuthRequest<unknown, unknown, { trackingKey: string }>,
  res: ResponseWithStatusAndError<{ experimentId: string | null }>
) {
  const { org } = getOrgFromReq(req);
  const { trackingKey } = req.query;

  if (!trackingKey) {
    return res.status(400).json({
      status: 400,
      message: "Tracking key cannot be empty",
    });
  }

  const experiment = await getExperimentByTrackingKey(org.id, trackingKey + "");

  return res.status(200).json({
    status: 200,
    experimentId: experiment?.id || null,
  });
}

export async function getExperiment(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (!(await userHasAccess(req, experiment.organization))) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to view this experiment",
    });
    return;
  }

  let idea: IdeaInterface | undefined = undefined;
  if (experiment.ideaSource) {
    idea =
      (await IdeaModel.findOne({
        organization: experiment.organization,
        id: experiment.ideaSource,
      })) || undefined;
  }

  res.status(200).json({
    status: 200,
    experiment,
    idea,
  });
}

async function _getSnapshot(
  organization: string,
  id: string,
  phase?: string,
  dimension?: string,
  withResults: boolean = true
) {
  const experiment = await getExperimentById(organization, id);

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (experiment.organization !== organization) {
    throw new Error("You do not have access to view this experiment");
  }

  if (!phase) {
    // get the latest phase:
    phase = String(experiment.phases.length - 1);
  }

  return await getLatestSnapshot(
    experiment.id,
    parseInt(phase),
    dimension,
    withResults
  );
}

export async function getSnapshotWithDimension(
  req: AuthRequest<null, { id: string; phase: string; dimension: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id, phase, dimension } = req.params;
  const snapshot = await _getSnapshot(org.id, id, phase, dimension);

  const latest = await _getSnapshot(org.id, id, phase, dimension, false);

  res.status(200).json({
    status: 200,
    snapshot,
    latest,
  });
}
export async function getSnapshot(
  req: AuthRequest<null, { id: string; phase: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id, phase } = req.params;
  const snapshot = await _getSnapshot(org.id, id, phase);

  const latest = await _getSnapshot(org.id, id, phase, undefined, false);

  res.status(200).json({
    status: 200,
    snapshot,
    latest,
  });
}

export async function postSnapshotNotebook(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const notebook = await generateExperimentNotebook(id, org.id);

  res.status(200).json({
    status: 200,
    notebook,
  });
}

export async function getSnapshots(
  req: AuthRequest<unknown, unknown, { ids?: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const idsString = (req.query?.ids as string) || "";
  if (!idsString.length) {
    res.status(200).json({
      status: 200,
      snapshots: [],
    });
    return;
  }

  const ids = idsString.split(",");

  let snapshotsPromises: Promise<ExperimentSnapshotInterface | null>[] = [];
  snapshotsPromises = ids.map(async (i) => {
    return await _getSnapshot(org.id, i);
  });
  const snapshots = await Promise.all(snapshotsPromises);

  res.status(200).json({
    status: 200,
    snapshots: snapshots.filter((s) => !!s),
  });
  return;
}

export async function getNewFeatures(
  req: AuthRequest<unknown, unknown, { project?: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const allExperiments = await getAllExperiments(org.id);
  const projectFeatures = await getAllFeatures(org.id, project);

  const expMap = new Map();
  allExperiments.forEach((exp) => {
    const key = exp.trackingKey || exp.id;
    expMap.set(key, exp);
  });
  const newFeatures = new Map();
  // a feature can have multiple experiments.
  projectFeatures.forEach((f) => {
    Object.values(f.environmentSettings || {}).forEach((e) => {
      (e.rules || []).forEach((r) => {
        if (r.type === "experiment") {
          const tKey = r.trackingKey || f.id;
          if (!expMap.get(tKey)) {
            // this feature experiment has no report:
            newFeatures.set(tKey, {
              feature: f,
              rule: r,
              trackingKey: tKey,
              partialExperiment: getExperimentDefinitionFromFeatureAndRule(
                f,
                r
              ),
            });
          }
        }
      });
    });
  });

  res.status(200).json({
    status: 200,
    features: Array.from(newFeatures.values()).sort(
      (a, b) => b.feature.dateCreated - a.feature.dateCreated
    ),
  });
  return;
}

const getExperimentDefinitionFromFeatureAndRule = (
  feature: FeatureInterface,
  expRule: ExperimentRule
) => {
  const totalPercent = expRule.values.reduce((sum, w) => sum + w.weight, 0);

  const expDefinition: Partial<ExperimentInterfaceStringDates> = {
    trackingKey: expRule.trackingKey || feature.id,
    name: (expRule.trackingKey || feature.id) + " experiment",
    hypothesis: expRule.description || "",
    hashAttribute: expRule.hashAttribute,
    description: `Experiment analysis for the feature [**${feature.id}**](/features/${feature.id})`,
    variations: expRule.values.map((v, i) => {
      let name = i ? `Variation ${i}` : "Control";
      if (feature.valueType === "boolean") {
        name = v.value === "true" ? "On" : "Off";
      }
      return {
        id: uniqid("var_"),
        key: i + "",
        name,
        screenshots: [],
        description: v.value,
      };
    }),
    phases: [
      {
        name: "Main",
        seed: expRule.trackingKey || feature.id,
        coverage: totalPercent,
        variationWeights: expRule.values.map((v) =>
          totalPercent > 0 ? v.weight / totalPercent : 1 / expRule.values.length
        ),
        reason: "",
        dateStarted: new Date().toISOString(),
        condition: expRule.condition || "",
        namespace: expRule.namespace || {
          enabled: false,
          name: "",
          range: [0, 1],
        },
      },
    ],
  };
  return expDefinition;
};

const validateVariationIds = (variations: Variation[]) => {
  variations.forEach((variation, i) => {
    if (!variation.id) {
      variation.id = uniqid("var_");
    }
    if (!variation.key) {
      variation.key = i + "";
    }
  });
  const keys = variations.map((v) => v.key);
  if (keys.length !== new Set(keys).size) {
    throw new Error("Variation keys must be unique");
  }
};

/**
 * Creates a new experiment
 * @param req
 * @param res
 */
export async function postExperiments(
  req: AuthRequest<
    Partial<ExperimentInterface>,
    unknown,
    { allowDuplicateTrackingKey?: boolean }
  >,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);

  const data = req.body;
  data.organization = org.id;

  req.checkPermissions("createAnalyses", data.project);

  if (data.datasource) {
    const datasource = await getDataSourceById(data.datasource, org.id);
    if (!datasource) {
      res.status(403).json({
        status: 403,
        message: "Invalid datasource: " + data.datasource,
      });
      return;
    }
  }

  // Validate that specified metrics exist and belong to the organization
  if (data.metrics && data.metrics.length) {
    for (let i = 0; i < data.metrics.length; i++) {
      const metric = await getMetricById(data.metrics[i], data.organization);

      if (metric) {
        // Make sure it is tied to the same datasource as the experiment
        if (data.datasource && metric.datasource !== data.datasource) {
          res.status(400).json({
            status: 400,
            message:
              "Metrics must be tied to the same datasource as the experiment: " +
              data.metrics[i],
          });
          return;
        }
      } else {
        // new metric that's not recognized...
        res.status(403).json({
          status: 403,
          message: "Unknown metric: " + data.metrics[i],
        });
        return;
      }
    }
  }

  const obj: Omit<ExperimentInterface, "id"> = {
    organization: data.organization,
    archived: false,
    hashAttribute: data.hashAttribute || "",
    autoSnapshots: true,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    project: data.project,
    owner: data.owner || userId,
    trackingKey: data.trackingKey || "",
    datasource: data.datasource || "",
    exposureQueryId: data.exposureQueryId || "",
    userIdType: data.userIdType || "anonymous",
    name: data.name || "",
    phases: data.phases || [],
    tags: data.tags || [],
    description: data.description || "",
    hypothesis: data.hypothesis || "",
    metrics: data.metrics || [],
    metricOverrides: data.metricOverrides || [],
    guardrails: data.guardrails || [],
    activationMetric: data.activationMetric || "",
    segment: data.segment || "",
    queryFilter: data.queryFilter || "",
    skipPartialData: !!data.skipPartialData,
    removeMultipleExposures: !!data.removeMultipleExposures,
    attributionModel: data.attributionModel || "firstExposure",
    variations: data.variations || [],
    implementation: data.implementation || "code",
    status: data.status || "draft",
    results: data.results || undefined,
    analysis: data.analysis || "",
    releasedVariationId: "",
    autoAssign: data.autoAssign || false,
    previewURL: data.previewURL || "",
    targetURLRegex: data.targetURLRegex || "",
    ideaSource: data.ideaSource || "",
    visualEditorUrl: data.visualEditorUrl || "",
  };

  try {
    validateVariationIds(obj.variations);

    // Make sure id is unique
    if (obj.trackingKey && !req.query.allowDuplicateTrackingKey) {
      const existing = await getExperimentByTrackingKey(
        org.id,
        obj.trackingKey
      );
      if (existing) {
        return res.status(200).json({
          status: 200,
          duplicateTrackingKey: true,
          existingId: existing.id,
        });
      }
    }

    const experiment = await createExperiment(obj, org);

    await req.audit({
      event: "experiment.create",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate(experiment),
    });

    await ensureWatching(userId, org.id, experiment.id, "experiments");

    await experimentUpdated(experiment);

    res.status(200).json({
      status: 200,
      experiment,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

/**
 * Update an experiment
 * @param req
 * @param res
 */
export async function postExperiment(
  req: AuthRequest<
    ExperimentInterfaceStringDates & {
      currentPhase?: number;
      phaseStartDate?: string;
      phaseEndDate?: string;
    },
    { id: string }
  >,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);
  const { id } = req.params;
  const { phaseStartDate, phaseEndDate, currentPhase, ...data } = req.body;

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  const previousExperiment = cloneDeep(experiment);

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", experiment.project);

  if (data.datasource) {
    const datasource = await getDataSourceById(data.datasource, org.id);
    if (!datasource) {
      res.status(403).json({
        status: 403,
        message: "Invalid datasource: " + data.datasource,
      });
      return;
    }
  }

  if (data.metrics && data.metrics.length) {
    for (let i = 0; i < data.metrics.length; i++) {
      const metric = await getMetricById(data.metrics[i], org.id);

      if (metric) {
        // Make sure it is tied to the same datasource as the experiment
        if (
          experiment.datasource &&
          metric.datasource !== experiment.datasource
        ) {
          res.status(400).json({
            status: 400,
            message:
              "Metrics must be tied to the same datasource as the experiment: " +
              data.metrics[i],
          });
          return;
        }
      } else {
        // new metric that's not recognized...
        res.status(403).json({
          status: 403,
          message: "Unknown metric: " + data.metrics[i],
        });
        return;
      }
    }
  }

  if (data.variations) {
    validateVariationIds(data.variations);
  }

  const keys: (keyof ExperimentInterface)[] = [
    "trackingKey",
    "owner",
    "datasource",
    "exposureQueryId",
    "userIdType",
    "hashAttribute",
    "name",
    "tags",
    "description",
    "hypothesis",
    "activationMetric",
    "segment",
    "queryFilter",
    "skipPartialData",
    "removeMultipleExposures",
    "attributionModel",
    "metrics",
    "metricOverrides",
    "guardrails",
    "variations",
    "status",
    "results",
    "analysis",
    "winner",
    "implementation",
    "autoAssign",
    "previewURL",
    "targetURLRegex",
    "releasedVariationId",
    "autoSnapshots",
    "project",
    "visualEditorUrl",
  ];
  const existing: ExperimentInterface = experiment;
  const changes: Changeset = {};

  keys.forEach((key) => {
    if (!(key in data)) {
      return;
    }

    // Do a deep comparison for arrays, shallow for everything else
    let hasChanges = data[key] !== existing[key];
    if (
      key === "metrics" ||
      key === "metricOverrides" ||
      key === "variations"
    ) {
      hasChanges = JSON.stringify(data[key]) !== JSON.stringify(existing[key]);
    }

    if (hasChanges) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (changes as any)[key] = data[key];
    }
  });

  // If changing phase start/end dates (from "Configure Analysis" modal)
  if (
    experiment.status !== "draft" &&
    currentPhase !== undefined &&
    experiment.phases?.[currentPhase] &&
    (phaseStartDate || phaseEndDate)
  ) {
    const phases = [...experiment.phases];
    const phaseClone = { ...phases[currentPhase] };
    phases[Math.floor(currentPhase * 1)] = phaseClone;

    if (phaseStartDate) {
      phaseClone.dateStarted = getValidDate(phaseStartDate + ":00Z");
    }
    if (experiment.status === "stopped" && phaseEndDate) {
      phaseClone.dateEnded = getValidDate(phaseEndDate + ":00Z");
    }
    changes.phases = phases;
  }

  const updated = await updateExperimentById(org.id, experiment, changes);

  await req.audit({
    event: "experiment.update",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  try {
    await logExperimentUpdated({
      organization: org,
      current: experiment,
      previous: previousExperiment,
    });
  } catch (e) {
    logger.error(e);
  }

  // If there are new tags to add
  await addTagsDiff(org.id, experiment.tags || [], data.tags || []);

  await ensureWatching(userId, org.id, experiment.id, "experiments");

  res.status(200).json({
    status: 200,
    experiment: updated,
  });
}

export async function postExperimentArchive(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const experiment = await getExperimentById(org.id, id);

  const changes: Changeset = {};

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", experiment.project);

  changes.archived = true;

  try {
    await updateExperimentById(org.id, experiment, changes);

    // TODO: audit
    res.status(200).json({
      status: 200,
    });

    await req.audit({
      event: "experiment.archive",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to archive experiment",
    });
  }
}

export async function postExperimentUnarchive(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const experiment = await getExperimentById(org.id, id);
  const changes: Changeset = {};

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", experiment.project);

  changes.archived = false;

  try {
    await updateExperimentById(org.id, experiment, changes);

    // TODO: audit
    res.status(200).json({
      status: 200,
    });

    await req.audit({
      event: "experiment.unarchive",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to unarchive experiment",
    });
  }
}

export async function postExperimentStatus(
  req: AuthRequest<
    {
      status: ExperimentStatus;
      reason: string;
      dateEnded: string;
    },
    { id: string }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { status, reason, dateEnded } = req.body;
  const changes: Changeset = {};

  const experiment = await getExperimentById(org.id, id);
  if (!experiment) {
    throw new Error("Experiment not found");
  }
  if (experiment.organization !== org.id) {
    throw new Error("You do not have access to this experiment");
  }
  req.checkPermissions("createAnalyses", experiment.project);

  // If status changed from running to stopped, update the latest phase
  const phases = [...experiment.phases];
  if (
    experiment.status === "running" &&
    status === "stopped" &&
    phases?.length > 0 &&
    !phases[phases.length - 1].dateEnded
  ) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      reason,
      dateEnded: dateEnded ? getValidDate(dateEnded + ":00Z") : new Date(),
    };
    changes.phases = phases;
  }

  changes.status = status;

  const updated = await updateExperimentById(org.id, experiment, changes);

  await req.audit({
    event: "experiment.status",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postExperimentStop(
  req: AuthRequest<
    { reason: string; dateEnded: string } & Partial<ExperimentInterface>,
    { id: string }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const {
    reason,
    results,
    analysis,
    winner,
    dateEnded,
    releasedVariationId,
  } = req.body;

  const experiment = await getExperimentById(org.id, id);
  const changes: Changeset = {};

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }
  req.checkPermissions("createAnalyses", experiment.project);

  const phases = [...experiment.phases];
  // Already has phases
  if (phases.length) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      dateEnded: dateEnded ? getValidDate(dateEnded + ":00Z") : new Date(),
      reason,
    };
    changes.phases = phases;
  }

  // Make sure experiment is stopped
  let isEnding = false;
  if (experiment.status === "running") {
    changes.status = "stopped";
    isEnding = true;
  }

  // TODO: validation
  changes.winner = winner;
  changes.results = results;
  changes.analysis = analysis;
  changes.releasedVariationId = releasedVariationId;

  try {
    const updated = await updateExperimentById(org.id, experiment, changes);

    await req.audit({
      event: isEnding ? "experiment.stop" : "experiment.results",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsUpdate(experiment, updated),
    });

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to stop experiment",
    });
  }
}

export async function deleteExperimentPhase(
  req: AuthRequest<null, { id: string; phase: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id, phase } = req.params;
  const phaseIndex = parseInt(phase);

  const experiment = await getExperimentById(org.id, id);
  const changes: Changeset = {};

  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", experiment.project);

  if (phaseIndex < 0 || phaseIndex >= experiment.phases?.length) {
    throw new Error("Invalid phase id");
  }

  // Remove an element from an array without mutating the original
  changes.phases = experiment.phases.filter((phase, i) => i !== phaseIndex);

  if (!changes.phases.length) {
    changes.status = "draft";
  }
  const updated = await updateExperimentById(org.id, experiment, changes);

  await updateSnapshotsOnPhaseDelete(org.id, id, phaseIndex);

  // Add audit entry
  await req.audit({
    event: "experiment.phase.delete",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function putExperimentPhase(
  req: AuthRequest<ExperimentPhase, { id: string; phase: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const i = parseInt(req.params.phase);
  const phase = req.body;
  const changes: Changeset = {};

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (experiment.organization !== org.id) {
    throw new Error("You do not have access to this experiment");
  }

  req.checkPermissions("createAnalyses", experiment.project);

  if (!experiment.phases?.[i]) {
    throw new Error("Invalid phase");
  }

  phase.dateStarted = phase.dateStarted
    ? getValidDate(phase.dateStarted + ":00Z")
    : new Date();
  phase.dateEnded = phase.dateEnded
    ? getValidDate(phase.dateEnded + ":00Z")
    : undefined;

  const phases = [...experiment.phases];
  phases[i] = {
    ...phases[i],
    ...phase,
  };
  changes.phases = phases;
  const updated = await updateExperimentById(org.id, experiment, changes);

  await req.audit({
    event: "experiment.phase",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postExperimentPhase(
  req: AuthRequest<ExperimentPhase, { id: string }>,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);
  const { id } = req.params;
  const { reason, dateStarted, ...data } = req.body;
  const changes: Changeset = {};

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }
  req.checkPermissions("createAnalyses", experiment.project);

  const date = dateStarted ? getValidDate(dateStarted + ":00Z") : new Date();

  const phases = [...experiment.phases];
  // Already has phases
  if (phases.length) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      dateEnded: date,
      reason,
    };
  }

  // Make sure experiment is running
  let isStarting = false;
  if (experiment.status === "draft") {
    changes.status = "running";
    isStarting = true;
  }

  phases.push({
    ...data,
    dateStarted: date,
    dateEnded: undefined,
    reason: "",
  });

  // TODO: validation
  try {
    changes.phases = phases;
    const updated = await updateExperimentById(org.id, experiment, changes);

    await req.audit({
      event: isStarting ? "experiment.start" : "experiment.phase",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsUpdate(experiment, updated),
    });

    await ensureWatching(userId, org.id, experiment.id, "experiments");

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to start new experiment phase",
    });
  }
}

export async function getWatchingUsers(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const watchers = await getExperimentWatchers(id, org.id);
  const userIds = watchers.map((w) => w.userId);
  res.status(200).json({
    status: 200,
    userIds,
  });
}

export async function deleteExperiment(
  req: AuthRequest<ExperimentInterface, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }
  req.checkPermissions("createAnalyses", experiment.project);

  await Promise.all([
    // note: we might want to change this to change the status to
    // 'deleted' instead of actually deleting the document.
    deleteExperimentByIdForOrganization(experiment, org),
    removeExperimentFromPresentations(experiment.id),
  ]);

  await req.audit({
    event: "experiment.delete",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsDelete(experiment),
  });

  await experimentUpdated(experiment);

  res.status(200).json({
    status: 200,
  });
}

export async function previewManualSnapshot(
  req: AuthRequest<
    {
      users: number[];
      metrics: { [key: string]: MetricStats[] };
    },
    { id: string; phase: string }
  >,
  res: Response
) {
  const { id, phase } = req.params;
  const { org } = getOrgFromReq(req);

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  const phaseIndex = parseInt(phase);
  if (!experiment.phases[phaseIndex]) {
    res.status(404).json({
      status: 404,
      message: "Phase not found",
    });
    return;
  }

  try {
    const data = await getManualSnapshotData(
      experiment,
      phaseIndex,
      req.body.users,
      req.body.metrics
    );
    res.status(200).json({
      status: 200,
      snapshot: data,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function getSnapshotStatus(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const snapshot = await findSnapshotById(org.id, id);
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "Unknown snapshot id",
    });
  }

  if (snapshot.organization !== org?.id)
    throw new Error("You don't have access to that snapshot");

  const experiment = await getExperimentById(org.id, snapshot.experiment);

  if (!experiment) throw new Error("Invalid experiment id");

  const phase = experiment.phases[snapshot.phase];

  const result = await getStatusEndpoint(
    snapshot,
    org.id,
    (queryData) =>
      analyzeExperimentResults(
        org.id,
        getReportVariations(experiment, phase),
        snapshot.dimension || undefined,
        queryData,
        org.settings?.statsEngine
      ),
    async (updates, results, error) => {
      await updateSnapshot(org.id, id, {
        ...updates,
        hasCorrectedStats: true,
        unknownVariations:
          results?.unknownVariations || snapshot.unknownVariations || [],
        multipleExposures:
          results?.multipleExposures ?? snapshot.multipleExposures ?? 0,
        results: results?.dimensions || snapshot.results,
        error,
      });
    },
    snapshot.error
  );
  return res.status(200).json(result);
}
export async function cancelSnapshot(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("runQueries", "");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const snapshot = await findSnapshotById(org.id, id);
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "No snapshot found with that id",
    });
  }
  res.status(200).json(
    await cancelRun(snapshot, org.id, async () => {
      await deleteSnapshotById(org.id, id);
    })
  );
}
export async function postSnapshot(
  req: AuthRequest<
    {
      phase: number;
      dimension?: string;
      users?: number[];
      metrics?: { [key: string]: MetricStats[] };
    },
    { id: string },
    { force?: string }
  >,
  res: Response
) {
  req.checkPermissions("runQueries", "");

  const { org } = getOrgFromReq(req);
  const statsEngine = org.settings?.statsEngine;

  const useCache = !req.query["force"];

  // This is doing an expensive analytics SQL query, so may take a long time
  // Set timeout to 30 minutes
  req.setTimeout(30 * 60 * 1000);

  const { id } = req.params;
  const { phase, dimension } = req.body;
  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (!experiment.phases[phase]) {
    res.status(404).json({
      status: 404,
      message: "Phase not found",
    });
    return;
  }

  // Manual snapshot
  if (!experiment.datasource) {
    const { users, metrics } = req.body;
    if (!users || !metrics) {
      throw new Error("Missing users and metric data");
    }

    try {
      const snapshot = await createManualSnapshot(
        experiment,
        phase,
        users,
        metrics,
        statsEngine
      );
      res.status(200).json({
        status: 200,
        snapshot,
      });

      await req.audit({
        event: "experiment.refresh",
        entity: {
          object: "experiment",
          id: experiment.id,
        },
        details: auditDetailsCreate({
          phase,
          users,
          metrics,
          manual: true,
        }),
      });
      return;
    } catch (e) {
      req.log.error(e, "Failed to create manual snapshot");
      res.status(400).json({
        status: 400,
        message: e.message,
      });
      return;
    }
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  try {
    const snapshot = await createSnapshot(
      experiment,
      phase,
      org,
      dimension || null,
      useCache,
      org.settings?.statsEngine
    );
    await req.audit({
      event: "experiment.refresh",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate({
        phase,
        dimension,
        useCache,
        manual: false,
      }),
    });
    res.status(200).json({
      status: 200,
      snapshot,
    });
  } catch (e) {
    req.log.error(e, "Failed to create experiment snapshot");
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function deleteScreenshot(
  req: AuthRequest<{ url: string }, { id: string; variation: number }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id, variation } = req.params;
  const { url } = req.body;
  const changes: Changeset = {};

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", experiment.project);

  if (!experiment.variations[variation]) {
    res.status(404).json({
      status: 404,
      message: "Unknown variation " + variation,
    });
    return;
  }

  changes.variations = cloneDeep(experiment.variations);

  // TODO: delete from s3 as well?
  changes.variations[variation].screenshots = changes.variations[
    variation
  ].screenshots.filter((s) => s.path !== url);
  const updated = await updateExperimentById(org.id, experiment, changes);

  await req.audit({
    event: "experiment.screenshot.delete",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(
      experiment.variations[variation].screenshots,
      updated?.variations[variation].screenshots,
      { variation }
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

type AddScreenshotRequestBody = {
  url: string;
  description?: string;
};
export async function addScreenshot(
  req: AuthRequest<AddScreenshotRequestBody, { id: string; variation: number }>,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);
  const { id, variation } = req.params;
  const { url, description } = req.body;
  const changes: Changeset = {};

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (experiment.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }
  req.checkPermissions("createAnalyses", experiment.project);

  if (!experiment.variations[variation]) {
    res.status(404).json({
      status: 404,
      message: "Unknown variation " + variation,
    });
    return;
  }

  experiment.variations[variation].screenshots =
    experiment.variations[variation].screenshots || [];

  changes.variations = cloneDeep(experiment.variations);

  changes.variations[variation].screenshots.push({
    path: url,
    description: description,
  });

  await updateExperimentById(org.id, experiment, changes);

  await req.audit({
    event: "experiment.screenshot.create",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsCreate({
      variation,
      url,
      description,
    }),
  });

  await ensureWatching(userId, org.id, experiment.id, "experiments");

  res.status(200).json({
    status: 200,
    screenshot: {
      path: url,
      description: description,
    },
  });
}

export async function getPastExperimentStatus(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const model = await PastExperimentsModel.findOne({ id });
  if (!model) {
    throw new Error("Could not get query status");
  }
  const result = await getStatusEndpoint(
    model,
    org.id,
    processPastExperiments,
    async (updates, experiments, error) => {
      await PastExperimentsModel.updateOne(
        { id },
        {
          $set: {
            ...updates,
            experiments: experiments || model.experiments,
            error,
          },
        }
      );
    },
    model.error
  );
  return res.status(200).json(result);
}
export async function cancelPastExperiments(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("runQueries", "");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const model = await PastExperimentsModel.findOne({
    id,
    organization: org.id,
  });
  if (!model) {
    throw new Error("Could not cancel query");
  }
  res.status(200).json(
    await cancelRun(model, org.id, async () => {
      model.set("queries", []);
      model.set("runStarted", null);
      await model.save();
    })
  );
}

export async function getPastExperimentsList(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const model = await PastExperimentsModel.findOne({
    id,
    organization: org.id,
  });

  if (!model) {
    throw new Error("Invalid import id");
  }

  const experiments = await getPastExperimentsByDatasource(
    org.id,
    model.datasource
  );

  const experimentMap = new Map<string, string>();
  (experiments || []).forEach((e) => {
    experimentMap.set(e.trackingKey, e.id);
  });

  const trackingKeyMap: Record<string, string> = {};
  (model.experiments || []).forEach((e) => {
    const id = experimentMap.get(e.trackingKey);
    if (id) {
      trackingKeyMap[e.trackingKey] = id;
    }
  });

  res.status(200).json({
    status: 200,
    experiments: model,
    existing: trackingKeyMap,
  });
}

//experiments/import, sent here right after "add experiment"
export async function postPastExperiments(
  req: AuthRequest<{ datasource: string; force: boolean }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { datasource, force } = req.body;

  const datasourceObj = await getDataSourceById(datasource, org.id);
  if (!datasourceObj) {
    throw new Error("Could not find datasource");
  }
  req.checkPermissions(
    "runQueries",
    datasourceObj?.projects?.length ? datasourceObj.projects : ""
  );

  const integration = getSourceIntegrationObject(datasourceObj);
  if (integration.decryptionError) {
    throw new Error(
      "Could not decrypt data source credentials. View the data source settings for more info."
    );
  }
  const start = new Date();
  start.setDate(start.getDate() - IMPORT_LIMIT_DAYS);
  const now = new Date();

  let model = await PastExperimentsModel.findOne({
    datasource,
    organization: org.id,
  });
  let runStarted = false;
  if (!model) {
    const { queries, result } = await startRun(
      {
        experiments: getPastExperiments(integration, start),
      },
      processPastExperiments
    );
    model = await PastExperimentsModel.create({
      id: uniqid("imp_"),
      organization: org.id,
      datasource: datasource,
      experiments: result || [],
      runStarted: now,
      config: {
        start,
        end: now,
      },
      error: "",
      queries,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    runStarted = true;
  } else if (force) {
    const { queries, result } = await startRun(
      {
        experiments: getPastExperiments(integration, start),
      },
      processPastExperiments
    );
    model.set("runStarted", now);
    model.set("error", "");
    model.set("queries", queries);
    model.set("config", {
      start: start,
      end: new Date(),
    });
    if (result) {
      model.set("experiments", result);
    }
    await model.save();
    runStarted = true;
  }

  res.status(200).json({
    status: 200,
    id: model.id,
  });

  if (runStarted) {
    await req.audit({
      event: "datasource.import",
      entity: {
        object: "datasource",
        id: datasource,
      },
    });
  }
}
