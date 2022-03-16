import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  getExperimentsByOrganization,
  getExperimentById,
  getLatestSnapshot,
  createMetric,
  createExperiment,
  createSnapshot,
  deleteExperimentById,
  createManualSnapshot,
  getManualSnapshotData,
  ensureWatching,
  processPastExperiments,
  removeMetricFromExperiments,
  experimentUpdated,
  getMetricAnalysis,
  refreshMetric,
  getExperimentsByMetric,
} from "../services/experiments";
import uniqid from "uniqid";
import {
  MetricAnalysis,
  MetricInterface,
  MetricStats,
} from "../../types/metric";
import { ExperimentModel } from "../models/ExperimentModel";
import { ExperimentSnapshotDocument } from "../models/ExperimentSnapshotModel";
import { getSourceIntegrationObject } from "../services/datasource";
import { addTagsDiff } from "../services/tag";
import { getOrgFromReq, userHasAccess } from "../services/organizations";
import { removeExperimentFromPresentations } from "../services/presentations";
import { WatchModel } from "../models/WatchModel";
import {
  getStatusEndpoint,
  startRun,
  cancelRun,
  getPastExperiments,
} from "../services/queries";
import format from "date-fns/format";
import { PastExperimentsModel } from "../models/PastExperimentsModel";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
  Variation,
} from "../../types/experiment";
import {
  deleteMetricById,
  getMetricsByOrganization,
  getMetricById,
  updateMetric,
} from "../models/MetricModel";
import { addGroupsDiff } from "../services/group";
import { IdeaModel } from "../models/IdeasModel";
import { IdeaInterface } from "../../types/idea";

import { ExperimentSnapshotModel } from "../models/ExperimentSnapshotModel";
import { getDataSourceById } from "../models/DataSourceModel";
import { generateExperimentNotebook } from "../services/notebook";
import { analyzeExperimentResults } from "../services/stats";
import { getValidDate } from "../util/dates";
import { getIdeasByQuery } from "../services/ideas";
import { ImpactEstimateModel } from "../models/ImpactEstimateModel";
import { getReportVariations } from "../services/reports";
import { IMPORT_LIMIT_DAYS } from "../util/secrets";
import { getAllFeatures } from "../models/FeatureModel";
import { ExperimentRule, FeatureInterface } from "../../types/feature";

export async function getExperiments(req: AuthRequest, res: Response) {
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
  req: AuthRequest<null, { num: string }>,
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

export async function getSnapshots(req: AuthRequest, res: Response) {
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

export async function getNewFeatures(req: AuthRequest, res: Response) {
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
  req: AuthRequest<Partial<ExperimentInterface>>,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);
  if (!req.permissions.draftExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const data = req.body;
  data.organization = org.id;

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
    userIdType: data.userIdType || "anonymous",
    name: data.name || "",
    phases: data.phases || [],
    tags: data.tags || [],
    description: data.description || "",
    hypothesis: data.hypothesis || "",
    metrics: data.metrics || [],
    guardrails: data.guardrails || [],
    activationMetric: data.activationMetric || "",
    segment: data.segment || "",
    queryFilter: data.queryFilter || "",
    skipPartialData: !!data.skipPartialData,
    removeMultipleExposures: !!data.removeMultipleExposures,
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
    const experiment = await createExperiment(obj, org);

    await req.audit({
      event: "experiment.create",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: JSON.stringify(experiment.toJSON()),
    });

    await ensureWatching(userId, org.id, experiment.id);

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

  const canEdit =
    exp.status === "draft"
      ? req.permissions.draftExperiments
      : req.permissions.runExperiments;
  if (!canEdit) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

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
    "metrics",
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
    if (key === "metrics" || key === "variations") {
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
    details: JSON.stringify(data),
  });

  // If there are new tags to add
  await addTagsDiff(org.id, existing.tags || [], data.tags || []);

  await ensureWatching(userId, org.id, exp.id);

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

export async function postExperimentStop(
  req: AuthRequest<
    { reason: string; dateEnded: string } & Partial<ExperimentInterface>,
    { id: string }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  if (!req.permissions.runExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

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
      details: JSON.stringify({
        winner,
        results,
        analysis,
        reason,
      }),
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
  if (!req.permissions.runExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

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

  if (phaseIndex < 0 || phaseIndex >= exp.phases?.length) {
    throw new Error("Invalid phase id");
  }

  // Remove phase from experiment and revert to draft if no more phases left
  const deleted = exp.phases.splice(phaseIndex, 1);
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
    details: JSON.stringify({
      phase: phaseIndex + 1,
      data: deleted[0],
    }),
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
  if (!req.permissions.runExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

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

  const date = dateStarted ? getValidDate(dateStarted + ":00Z") : new Date();

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
      details: JSON.stringify(data),
    });

    await ensureWatching(userId, org.id, exp.id);

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

export async function watchExperiment(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);
  const { id } = req.params;

  try {
    const exp = await getExperimentById(id);
    if (!exp) {
      throw new Error("Could not find experiment");
    }
    if (exp.organization !== org.id) {
      res.status(403).json({
        status: 403,
        message: "You do not have access to this experiment",
      });
      return;
    }

    await ensureWatching(userId, org.id, id);

    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function unwatchExperiment(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);
  const { id } = req.params;

  try {
    await WatchModel.updateOne(
      {
        userId: userId,
        organization: org.id,
      },
      {
        $pull: {
          experiments: id,
        },
      }
    );

    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function deleteMetric(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  if (!req.permissions.createMetrics) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id } = req.params;

  const metric = await getMetricById(id, org.id);

  if (!metric) {
    res.status(403).json({
      status: 404,
      message: "Metric not found",
    });
    return;
  }

  // delete references:
  // ideas (impact estimate)
  ImpactEstimateModel.updateMany(
    {
      metric: metric.id,
      organization: org.id,
    },
    { metric: "" }
  );

  // Experiments
  await removeMetricFromExperiments(metric.id, org.id);

  // now remove the metric itself:
  await deleteMetricById(metric.id, org.id);

  await req.audit({
    event: "metric.delete",
    entity: {
      object: "metric",
      id: metric.id,
    },
  });

  res.status(200).json({
    status: 200,
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

  const canEdit =
    exp.status === "draft"
      ? req.permissions.draftExperiments
      : req.permissions.runExperiments;
  if (!canEdit) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  await Promise.all([
    // note: we might want to change this to change the status to
    // 'deleted' instead of actually deleting the document.
    deleteExperimentById(exp.id),
    removeExperimentFromPresentations(exp.id),
  ]);

  await req.audit({
    event: "experiment.delete",
    entity: {
      object: "experiment",
      id: exp.id,
    },
  });

  await experimentUpdated(exp);

  res.status(200).json({
    status: 200,
  });
}

export async function getMetrics(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const metrics = await getMetricsByOrganization(org.id);
  res.status(200).json({
    status: 200,
    metrics,
  });
}

export async function getMetricUsage(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const { org } = getOrgFromReq(req);
  const metric = await getMetricById(id, org.id);

  if (!metric) {
    res.status(403).json({
      status: 404,
      message: "Metric not found",
    });
    return;
  }

  // metrics are used in a few places:

  // Ideas (impact estimate)
  const estimates = await ImpactEstimateModel.find({
    metric: metric.id,
    organization: org.id,
  });
  const ideas: IdeaInterface[] = [];
  if (estimates && estimates.length > 0) {
    await Promise.all(
      estimates.map(async (es) => {
        const idea = await getIdeasByQuery({
          organization: org.id,
          "estimateParams.estimate": es.id,
        });
        if (idea && idea[0]) {
          ideas.push(idea[0]);
        }
      })
    );
  }

  // Experiments
  const experiments = await getExperimentsByMetric(org.id, metric.id);

  res.status(200).json({
    ideas,
    experiments,
    status: 200,
  });
}

export async function getMetricAnalysisStatus(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const metric = await getMetricById(id, org.id, true);
  if (!metric) {
    throw new Error("Could not get query status");
  }
  const result = await getStatusEndpoint(
    metric,
    org.id,
    (queryData) => getMetricAnalysis(metric, queryData),
    async (updates, result?: MetricAnalysis, error?: string) => {
      const metricUpdates: Partial<MetricInterface> = {
        ...updates,
        analysisError: error,
      };
      if (result) {
        metricUpdates.analysis = result;
      }

      await updateMetric(id, metricUpdates, org.id);
    },
    metric.analysisError
  );
  return res.status(200).json(result);
}
export async function cancelMetricAnalysis(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const metric = await getMetricById(id, org.id, true);
  if (!metric) {
    throw new Error("Could not cancel query");
  }
  res.status(200).json(
    await cancelRun(metric, org.id, async () => {
      await updateMetric(
        id,
        {
          queries: [],
          runStarted: null,
        },
        org.id
      );
    })
  );
}

export async function postMetricAnalysis(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const metric = await getMetricById(id, org.id, true);

  if (!metric) {
    return res.status(404).json({
      status: 404,
      message: "Metric not found",
    });
  }

  try {
    await refreshMetric(
      metric,
      org.id,
      req.organization?.settings?.metricAnalysisDays
    );

    res.status(200).json({
      status: 200,
    });

    await req.audit({
      event: "metric.analysis",
      entity: {
        object: "metric",
        id: metric.id,
      },
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}
export async function getMetric(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const metric = await getMetricById(id, org.id, true);

  if (!metric) {
    return res.status(404).json({
      status: 404,
      message: "Metric not found",
    });
  }

  const experiments = await ExperimentModel.find(
    {
      organization: org.id,
      $or: [
        {
          metrics: metric.id,
        },
        {
          guardrails: metric.id,
        },
      ],
      archived: {
        $ne: true,
      },
    },
    {
      _id: false,
      id: true,
      name: true,
      status: true,
      phases: true,
      results: true,
      analysis: true,
    }
  )
    .sort({
      _id: -1,
    })
    .limit(10);

  res.status(200).json({
    status: 200,
    metric,
    experiments,
  });
}
export async function postMetrics(
  req: AuthRequest<Partial<MetricInterface>>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  if (!req.permissions.createMetrics) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const {
    name,
    description,
    type,
    table,
    column,
    inverse,
    ignoreNulls,
    cap,
    conversionWindowHours,
    conversionDelayHours,
    sql,
    aggregation,
    segment,
    tags,
    winRisk,
    loseRisk,
    maxPercentChange,
    minPercentChange,
    minSampleSize,
    conditions,
    datasource,
    timestampColumn,
    userIdType,
    userIdColumn,
    anonymousIdColumn,
  } = req.body;

  if (datasource) {
    const datasourceObj = await getDataSourceById(datasource, org.id);
    if (!datasourceObj) {
      res.status(403).json({
        status: 403,
        message: "Invalid data source: " + datasource,
      });
      return;
    }
  }

  const metric = await createMetric({
    organization: org.id,
    datasource,
    name,
    description,
    type,
    segment,
    table,
    column,
    inverse,
    ignoreNulls,
    cap,
    conversionWindowHours,
    conversionDelayHours,
    userIdType,
    sql,
    aggregation,
    status: "active",
    userIdColumn,
    anonymousIdColumn,
    timestampColumn,
    conditions,
    tags,
    winRisk,
    loseRisk,
    maxPercentChange,
    minPercentChange,
    minSampleSize,
  });

  res.status(200).json({
    status: 200,
    metric,
  });

  await req.audit({
    event: "metric.create",
    entity: {
      object: "metric",
      id: metric.id,
    },
    details: JSON.stringify(metric),
  });
}

export async function putMetric(
  req: AuthRequest<Partial<MetricInterface>, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  if (!req.permissions.createMetrics) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id } = req.params;
  const metric = await getMetricById(id, org.id);
  if (!metric) {
    throw new Error("Could not find metric");
  }

  const updates: Partial<MetricInterface> = {};

  const fields: (keyof MetricInterface)[] = [
    "name",
    "description",
    "segment",
    "type",
    "inverse",
    "ignoreNulls",
    "cap",
    "conversionWindowHours",
    "conversionDelayHours",
    "sql",
    "aggregation",
    "status",
    "tags",
    "winRisk",
    "loseRisk",
    "maxPercentChange",
    "minPercentChange",
    "minSampleSize",
    "conditions",
    "dateUpdated",
    "table",
    "column",
    "userIdType",
    "userIdColumn",
    "anonymousIdColumn",
    "timestampColumn",
  ];
  fields.forEach((k) => {
    if (k in req.body) {
      // eslint-disable-next-line
      (updates as any)[k] = req.body[k];
    }
  });

  await updateMetric(metric.id, updates, org.id);

  await addTagsDiff(org.id, metric.tags || [], req.body.tags || []);

  res.status(200).json({
    status: 200,
  });

  await req.audit({
    event: "metric.update",
    entity: {
      object: "metric",
      id: metric.id,
    },
    details: JSON.stringify(updates),
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
        queryData
      ),
    async (updates, results, error) => {
      await ExperimentSnapshotModel.updateOne(
        {
          id,
        },
        {
          $set: {
            ...updates,
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
    { id: string }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  if (!req.permissions.runExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

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
      const snapshot = await createManualSnapshot(exp, phase, users, metrics);
      res.status(200).json({
        status: 200,
        snapshot,
      });

      await req.audit({
        event: "snapshot.create.manual",
        entity: {
          object: "snapshot",
          id: snapshot.id,
        },
        parent: {
          object: "experiment",
          id: exp.id,
        },
        details: JSON.stringify(req.body),
      });
      return;
    } catch (e) {
      res.status(400).json({
        status: 400,
        message: e.message,
      });
      console.error(e);
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
      useCache
    );
    await req.audit({
      event: "snapshot.create.auto",
      entity: {
        object: "snapshot",
        id: snapshot.id,
      },
      parent: {
        object: "experiment",
        id: exp.id,
      },
    });
    res.status(200).json({
      status: 200,
      snapshot,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
    console.error(e);
  }
}

export async function deleteScreenshot(
  req: AuthRequest<{ url: string }, { id: string; variation: number }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  if (!req.permissions.draftExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

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

  if (!exp.variations[variation]) {
    res.status(404).json({
      status: 404,
      message: "Unknown variation " + variation,
    });
    return;
  }

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
    details: JSON.stringify({
      variation,
      url,
    }),
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
  if (!req.permissions.draftExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

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
    details: JSON.stringify({
      variation,
      url,
      description,
    }),
  });

  await ensureWatching(userId, org.id, exp.id);

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

  const integration = getSourceIntegrationObject(datasourceObj);
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
        experiments: getPastExperiments(
          integration,
          start,
          org?.settings?.pastExperimentsMinLength
        ),
      },
      processPastExperiments
    );
    model = await PastExperimentsModel.create({
      id: uniqid("imp_"),
      organization: org.id,
      datasource: datasource,
      experiments: result || [],
      runStarted: now,
      error: "",
      queries,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    runStarted = true;
  } else if (force) {
    const { queries, result } = await startRun(
      {
        experiments: getPastExperiments(
          integration,
          start,
          org?.settings?.pastExperimentsMinLength
        ),
      },
      processPastExperiments
    );
    model.set("runStarted", now);
    model.set("error", "");
    model.set("queries", queries);
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
