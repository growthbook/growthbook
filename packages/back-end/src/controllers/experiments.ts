import { Response } from "express";
import uniqid from "uniqid";
import format from "date-fns/format";
import { AuthRequest, ResponseWithStatusAndError } from "../types/AuthRequest";
import {
  getExperimentsByOrganization,
  getExperimentById,
  getLatestSnapshot,
  createExperiment,
  createSnapshot,
  deleteExperimentByIdForOrganization,
  createManualSnapshot,
  getManualSnapshotData,
  ensureWatching,
  processPastExperiments,
  experimentUpdated,
  getExperimentWatchers,
  getExperimentByTrackingKey,
} from "../services/experiments";
import { MetricStats } from "../../types/metric";
import { ExperimentModel } from "../models/ExperimentModel";
import {
  ExperimentSnapshotDocument,
  ExperimentSnapshotModel,
} from "../models/ExperimentSnapshotModel";
import { getSourceIntegrationObject } from "../services/datasource";
import { addTagsDiff } from "../models/TagModel";
import { getOrgFromReq, userHasAccess } from "../services/organizations";
import { removeExperimentFromPresentations } from "../services/presentations";
import {
  getStatusEndpoint,
  startRun,
  cancelRun,
  getPastExperiments,
} from "../services/queries";
import { PastExperimentsModel } from "../models/PastExperimentsModel";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
  ExperimentStatus,
  Variation,
} from "../../types/experiment";
import { getMetricById } from "../models/MetricModel";
import { addGroupsDiff } from "../services/group";
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
  auditDetailsUpdate,
  auditDetailsDelete,
} from "../services/audit";

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

  const experiments = await getExperimentsByOrganization(org.id, project);

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
  const experiments = await getExperimentsByOrganization(org.id, project);

  const allData: { name: string; numExp: number }[] = [];

  // make the data array with all the months needed and 0 experiments.
  for (let i = parseInt(num) - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const ob = {
      name: format(d, "MMM yyy"),
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
        // get the earliest time it was main or ramp:
        if (p.phase === "main" || p.phase === "ramp") {
          if (p.dateStarted && (!dateStarted || p.dateStarted < dateStarted))
            dateStarted = p.dateStarted;
        }
      });
    }
    const monthYear = format(getValidDate(dateStarted), "MMM yyy");

    allData.forEach((md, i) => {
      if (md.name === monthYear) {
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
  const { id } = req.params;

  const experiment = await getExperimentById(id);

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
  const experiment = await getExperimentById(id);

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

  let snapshotsPromises: Promise<ExperimentSnapshotDocument>[] = [];
  snapshotsPromises = ids.map(async (i) => {
    return await _getSnapshot(org.id, i);
  });
  const snapshots = await Promise.all(snapshotsPromises);

  res.status(200).json({
    status: 200,
    snapshots,
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

  const allExperiments = await getExperimentsByOrganization(org.id);
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
    description: `Experiment analysis for the feature [**${feature.id}**](/features/${feature.id})`,
    variations: expRule.values.map((v, i) => {
      let name = i ? `Variation ${i}` : "Control";
      if (feature.valueType === "boolean") {
        name = v.value === "true" ? "On" : "Off";
      }
      return {
        name,
        screenshots: [],
        description: v.value,
      };
    }),
    phases: [
      {
        coverage: totalPercent,
        variationWeights: expRule.values.map((v) =>
          totalPercent > 0 ? v.weight / totalPercent : 1 / expRule.values.length
        ),
        phase: "main",
        reason: "",
        dateStarted: new Date().toISOString(),
      },
    ],
  };
  return expDefinition;
};

const validateVariationIds = (variations: Variation[]) => {
  const ids = variations.map((v, i) => v.key || i + "");

  if (ids.length !== new Set(ids).size) {
    throw new Error("Variation ids must be unique");
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

  const obj: Partial<ExperimentInterface> = {
    organization: data.organization,
    project: data.project,
    owner: data.owner || userId,
    trackingKey: data.trackingKey || undefined,
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
    autoAssign: data.autoAssign || false,
    previewURL: data.previewURL || "",
    targetURLRegex: data.targetURLRegex || "",
    data: data.data || "",
    ideaSource: data.ideaSource || "",
  };

  try {
    validateVariationIds(obj.variations || []);

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
      details: auditDetailsCreate(experiment.toJSON()),
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

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", exp.project);

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
        if (exp.datasource && metric.datasource !== exp.datasource) {
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
    "data",
    "autoSnapshots",
    "project",
  ];
  const keysRequiringWebhook: (keyof ExperimentInterface)[] = [
    "trackingKey",
    "userIdType",
    "variations",
    "status",
    "winner",
    "implementation",
    "targetURLRegex",
    "project",
  ];
  const existing: ExperimentInterface = exp.toJSON();
  let requiresWebhook = false;
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
      exp.set(key, data[key]);
      if (keysRequiringWebhook.includes(key)) {
        requiresWebhook = true;
      }
    }
  });

  // If changing phase start/end dates (from "Configure Analysis" modal)
  if (
    exp.status !== "draft" &&
    currentPhase !== undefined &&
    exp.phases?.[currentPhase] &&
    (phaseStartDate || phaseEndDate)
  ) {
    const phases = [...exp.toJSON().phases];
    const phaseClone = { ...phases[currentPhase] };
    phases[Math.floor(currentPhase * 1)] = phaseClone;

    if (phaseStartDate) {
      phaseClone.dateStarted = getValidDate(phaseStartDate + ":00Z");
    }
    if (exp.status === "stopped" && phaseEndDate) {
      phaseClone.dateEnded = getValidDate(phaseEndDate + ":00Z");
    }
    exp.set("phases", phases);
  }

  await exp.save();

  await req.audit({
    event: "experiment.update",
    entity: {
      object: "experiment",
      id: exp.id,
    },
    details: auditDetailsUpdate(existing, exp.toJSON()),
  });

  // If there are new tags to add
  await addTagsDiff(org.id, existing.tags || [], data.tags || []);

  await ensureWatching(userId, org.id, exp.id, "experiments");

  if (requiresWebhook) {
    await experimentUpdated(exp, existing.project || "");
  }

  res.status(200).json({
    status: 200,
    experiment: exp,
  });
}

export async function postExperimentArchive(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", exp.project);

  exp.set("archived", true);

  try {
    await exp.save();

    await experimentUpdated(exp);

    // TODO: audit
    res.status(200).json({
      status: 200,
    });

    await req.audit({
      event: "experiment.archive",
      entity: {
        object: "experiment",
        id: exp.id,
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

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", exp.project);

  exp.set("archived", false);

  try {
    await exp.save();

    await experimentUpdated(exp);

    // TODO: audit
    res.status(200).json({
      status: 200,
    });

    await req.audit({
      event: "experiment.unarchive",
      entity: {
        object: "experiment",
        id: exp.id,
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

  const exp = await getExperimentById(id);
  if (!exp) {
    throw new Error("Experiment not found");
  }
  if (exp.organization !== org.id) {
    throw new Error("You do not have access to this experiment");
  }
  req.checkPermissions("createAnalyses", exp.project);

  const existing = exp.toJSON();

  // If status changed from running to stopped, update the latest phase
  const phases = [...existing.phases];
  if (
    exp.status === "running" &&
    status === "stopped" &&
    phases?.length > 0 &&
    !phases[phases.length - 1].dateEnded
  ) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      reason,
      dateEnded: dateEnded ? getValidDate(dateEnded + ":00Z") : new Date(),
    };
    exp.set("phases", phases);
  }

  exp.set("status", status);

  await exp.save();

  await req.audit({
    event: "experiment.status",
    entity: {
      object: "experiment",
      id: exp.id,
    },
    details: auditDetailsUpdate(existing, exp.toJSON()),
  });

  await experimentUpdated(exp);

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
  const { reason, results, analysis, winner, dateEnded } = req.body;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }
  req.checkPermissions("createAnalyses", exp.project);

  const existing = exp.toJSON();

  const phases = [...exp.toJSON().phases];
  // Already has phases
  if (phases.length) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      dateEnded: dateEnded ? getValidDate(dateEnded + ":00Z") : new Date(),
      reason,
    };
    exp.set("phases", phases);
  }

  // Make sure experiment is stopped
  let isEnding = false;
  if (exp.status === "running") {
    exp.set("status", "stopped");
    isEnding = true;
  }

  // TODO: validation
  exp.set("winner", winner);
  exp.set("results", results);
  exp.set("analysis", analysis);

  try {
    await exp.save();

    await req.audit({
      event: isEnding ? "experiment.stop" : "experiment.results",
      entity: {
        object: "experiment",
        id: exp.id,
      },
      details: auditDetailsUpdate(existing, exp.toJSON()),
    });

    await experimentUpdated(exp);

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

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", exp.project);

  if (phaseIndex < 0 || phaseIndex >= exp.phases?.length) {
    throw new Error("Invalid phase id");
  }

  const existing = exp.toJSON();

  // Remove phase from experiment and revert to draft if no more phases left
  exp.phases.splice(phaseIndex, 1);
  exp.markModified("phases");

  if (!exp.phases.length) {
    exp.set("status", "draft");
  }
  await exp.save();

  // Delete all snapshots for the phase
  await ExperimentSnapshotModel.deleteMany({
    organization: org.id,
    experiment: id,
    phase: phaseIndex,
  });

  // Decrement the phase index for all later phases
  await ExperimentSnapshotModel.updateMany(
    {
      organization: org.id,
      experiment: id,
      phase: {
        $gt: phaseIndex,
      },
    },
    {
      $inc: {
        phase: -1,
      },
    }
  );

  // Add audit entry
  await req.audit({
    event: "experiment.phase.delete",
    entity: {
      object: "experiment",
      id: exp.id,
    },
    details: auditDetailsUpdate(existing, exp.toJSON()),
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

  const exp = await getExperimentById(id);

  if (!exp) {
    throw new Error("Experiment not found");
  }

  if (exp.organization !== org.id) {
    throw new Error("You do not have access to this experiment");
  }

  req.checkPermissions("createAnalyses", exp.project);

  const existing = exp.toJSON();

  if (!existing.phases?.[i]) {
    throw new Error("Invalid phase");
  }

  phase.dateStarted = phase.dateStarted
    ? getValidDate(phase.dateStarted + ":00Z")
    : new Date();
  phase.dateEnded = phase.dateEnded
    ? getValidDate(phase.dateEnded + ":00Z")
    : undefined;

  const phases = [...existing.phases];
  phases[i] = {
    ...phases[i],
    ...phase,
  };
  exp.set("phases", phases);
  await exp.save();

  await req.audit({
    event: "experiment.phase",
    entity: {
      object: "experiment",
      id: exp.id,
    },
    details: auditDetailsUpdate(existing, exp.toJSON()),
  });

  await experimentUpdated(exp);

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

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }
  req.checkPermissions("createAnalyses", exp.project);

  const date = dateStarted ? getValidDate(dateStarted + ":00Z") : new Date();

  const existing = exp.toJSON();

  const phases = [...exp.toJSON().phases];
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
  if (exp.status === "draft") {
    exp.set("status", "running");
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
    exp.set("phases", phases);
    await exp.save();

    await addGroupsDiff(org.id, [], data.groups || []);

    await req.audit({
      event: isStarting ? "experiment.start" : "experiment.phase",
      entity: {
        object: "experiment",
        id: exp.id,
      },
      details: auditDetailsUpdate(existing, exp.toJSON()),
    });

    await ensureWatching(userId, org.id, exp.id, "experiments");

    await experimentUpdated(exp);

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

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }
  req.checkPermissions("createAnalyses", exp.project);

  await Promise.all([
    // note: we might want to change this to change the status to
    // 'deleted' instead of actually deleting the document.
    deleteExperimentByIdForOrganization(exp.id, org),
    removeExperimentFromPresentations(exp.id),
  ]);

  await req.audit({
    event: "experiment.delete",
    entity: {
      object: "experiment",
      id: exp.id,
    },
    details: auditDetailsDelete(exp.toJSON()),
  });

  await experimentUpdated(exp);

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

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  const phaseIndex = parseInt(phase);
  if (!exp.phases[phaseIndex]) {
    res.status(404).json({
      status: 404,
      message: "Phase not found",
    });
    return;
  }

  try {
    const data = await getManualSnapshotData(
      exp,
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
  const snapshot = await ExperimentSnapshotModel.findOne({ id });
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "Unknown snapshot id",
    });
  }

  if (snapshot.organization !== org?.id)
    throw new Error("You don't have access to that snapshot");

  const experiment = await ExperimentModel.findOne({
    id: snapshot.experiment,
  });
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
      await ExperimentSnapshotModel.updateOne(
        {
          id,
        },
        {
          $set: {
            ...updates,
            hasCorrectedStats: true,
            unknownVariations:
              results?.unknownVariations || snapshot.unknownVariations || [],
            multipleExposures:
              results?.multipleExposures ?? snapshot.multipleExposures ?? 0,
            results: results?.dimensions || snapshot.results,
            error,
          },
        }
      );
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
  const snapshot = await ExperimentSnapshotModel.findOne({
    id,
    organization: org.id,
  });
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "No snapshot found with that id",
    });
  }
  res.status(200).json(
    await cancelRun(snapshot, org.id, async () => {
      await ExperimentSnapshotModel.deleteOne({
        id,
      });
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
  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (!exp.phases[phase]) {
    res.status(404).json({
      status: 404,
      message: "Phase not found",
    });
    return;
  }

  // Manual snapshot
  if (!exp.datasource) {
    const { users, metrics } = req.body;
    if (!users || !metrics) {
      throw new Error("Missing users and metric data");
    }

    try {
      const snapshot = await createManualSnapshot(
        exp,
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
          id: exp.id,
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

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  try {
    const snapshot = await createSnapshot(
      exp,
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
        id: exp.id,
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

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  req.checkPermissions("createAnalyses", exp.project);

  if (!exp.variations[variation]) {
    res.status(404).json({
      status: 404,
      message: "Unknown variation " + variation,
    });
    return;
  }

  const existing = [...exp.variations[variation].screenshots];

  // TODO: delete from s3 as well?
  exp.variations[variation].screenshots = exp.variations[
    variation
  ].screenshots.filter((s) => s.path !== url);
  exp.markModified(`variations[${variation}]`);
  await exp.save();

  await req.audit({
    event: "experiment.screenshot.delete",
    entity: {
      object: "experiment",
      id: exp.id,
    },
    details: auditDetailsUpdate(
      existing,
      exp.variations[variation].screenshots,
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

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }
  req.checkPermissions("createAnalyses", exp.project);

  if (!exp.variations[variation]) {
    res.status(404).json({
      status: 404,
      message: "Unknown variation " + variation,
    });
    return;
  }

  exp.variations[variation].screenshots =
    exp.variations[variation].screenshots || [];
  exp.variations[variation].screenshots.push({
    path: url,
    description: description,
  });
  exp.markModified(`variations[${variation}]`);
  await exp.save();

  await req.audit({
    event: "experiment.screenshot.create",
    entity: {
      object: "experiment",
      id: exp.id,
    },
    details: auditDetailsCreate({
      variation,
      url,
      description,
    }),
  });

  await ensureWatching(userId, org.id, exp.id, "experiments");

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

  const experiments = await ExperimentModel.find(
    {
      organization: org.id,
      datasource: model.datasource,
    },
    {
      _id: false,
      id: true,
      trackingKey: true,
    }
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
