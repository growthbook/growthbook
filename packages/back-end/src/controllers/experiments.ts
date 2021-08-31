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
  processSnapshotData,
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
import { userHasAccess } from "../services/organizations";
import { removeExperimentFromPresentations } from "../services/presentations";
import { WatchModel } from "../models/WatchModel";
import {
  getUsers,
  QueryMap,
  getMetricValue,
  getStatusEndpoint,
  startRun,
  cancelRun,
  getPastExperiments,
} from "../services/queries";
import {
  MetricValueResult,
  UsersResult,
  UsersQueryParams,
  MetricValueParams,
} from "../types/Integration";
import { findDimensionById } from "../models/DimensionModel";
import format from "date-fns/format";
import { PastExperimentsModel } from "../models/PastExperimentsModel";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import {
  deleteMetricById,
  getMetricsByOrganization,
  getMetricById,
  updateMetric,
} from "../models/MetricModel";
import { DimensionInterface } from "../../types/dimension";
import { addGroupsDiff } from "../services/group";
import { IdeaModel } from "../models/IdeasModel";
import { IdeaInterface } from "../../types/idea";
import { queueWebhook } from "../jobs/webhooks";
import { ExperimentSnapshotModel } from "../models/ExperimentSnapshotModel";
import { getDataSourceById } from "../models/DataSourceModel";

export async function getExperiments(req: AuthRequest, res: Response) {
  const experiments = await getExperimentsByOrganization(req.organization.id);

  res.status(200).json({
    status: 200,
    experiments,
  });
}

export async function getExperimentsFrequencyMonth(
  req: AuthRequest,
  res: Response
) {
  const { num }: { num: string } = req.params;
  const experiments = await getExperimentsByOrganization(req.organization.id);

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
    let dateStarted: Date;
    if (e.status === "draft") {
      dateStarted = e.dateCreated;
    } else {
      e.phases.forEach((p) => {
        // get the earliest time it was main or ramp:
        if (p.phase === "main" || p.phase === "ramp") {
          if (!dateStarted || p.dateStarted < dateStarted)
            dateStarted = p.dateStarted;
        }
      });
    }
    const monthYear = format(new Date(dateStarted), "MMM yyy");

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

export async function getExperiment(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;

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

  let idea: IdeaInterface;
  if (experiment.ideaSource) {
    idea = await IdeaModel.findOne({
      organization: experiment.organization,
      id: experiment.ideaSource,
    });
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
  req: AuthRequest,
  res: Response
) {
  const {
    id,
    phase,
    dimension,
  }: { id: string; phase: string; dimension: string } = req.params;
  const snapshot = await _getSnapshot(
    req.organization.id,
    id,
    phase,
    dimension
  );

  const latest = await _getSnapshot(
    req.organization.id,
    id,
    phase,
    dimension,
    false
  );

  res.status(200).json({
    status: 200,
    snapshot,
    latest,
  });
}
export async function getSnapshot(req: AuthRequest, res: Response) {
  const { id, phase }: { id: string; phase: string } = req.params;
  const snapshot = await _getSnapshot(req.organization.id, id, phase);

  const latest = await _getSnapshot(
    req.organization.id,
    id,
    phase,
    null,
    false
  );

  res.status(200).json({
    status: 200,
    snapshot,
    latest,
  });
}

export async function getSnapshots(req: AuthRequest, res: Response) {
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
    return await _getSnapshot(req.organization.id, i);
  });
  const snapshots = await Promise.all(snapshotsPromises);

  res.status(200).json({
    status: 200,
    snapshots,
  });
  return;
}

/**
 * Creates a new experiment
 * @param req
 * @param res
 */
export async function postExperiments(
  req: AuthRequest<Partial<ExperimentInterface>>,
  res: Response
) {
  if (!req.permissions.draftExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const data = req.body;
  data.organization = req.organization.id;

  if (data.datasource) {
    const datasource = await getDataSourceById(
      data.datasource,
      req.organization.id
    );
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
    owner: data.owner || req.userId,
    trackingKey: data.trackingKey || null,
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
    variations: data.variations || [],
    implementation: data.implementation || "code",
    status: data.status || "draft",
    results: data.results || null,
    analysis: data.analysis || "",
    autoAssign: data.autoAssign || false,
    previewURL: data.previewURL || "",
    targetURLRegex: data.targetURLRegex || "",
    data: data.data || "",
    ideaSource: data.ideaSource || "",
  };
  try {
    const experiment = await createExperiment(obj);

    await req.audit({
      event: "experiment.create",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: JSON.stringify(experiment.toJSON()),
    });

    await ensureWatching(req.userId, req.organization.id, experiment.id);

    await queueWebhook(req.organization.id);

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
  req: AuthRequest<ExperimentInterface>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const data = req.body;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== req.organization.id) {
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
    const datasource = await getDataSourceById(
      data.datasource,
      req.organization.id
    );
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
      const metric = await getMetricById(data.metrics[i], req.organization.id);

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
  ];
  const keysRequiringWebhook: (keyof ExperimentInterface)[] = [
    "trackingKey",
    "userIdType",
    "variations",
    "status",
    "winner",
    "implementation",
    "targetURLRegex",
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
  await addTagsDiff(req.organization.id, existing.tags || [], data.tags || []);

  await ensureWatching(req.userId, req.organization.id, exp.id);

  if (requiresWebhook) {
    await queueWebhook(req.organization.id);
  }

  res.status(200).json({
    status: 200,
    experiment: exp,
  });
}

export async function postExperimentArchive(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  exp.set("archived", true);

  try {
    await exp.save();

    await queueWebhook(req.organization.id);

    // TODO: audit
    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to archive experiment",
    });
  }
}

export async function postExperimentUnarchive(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  exp.set("archived", false);

  try {
    await exp.save();

    await queueWebhook(req.organization.id);

    // TODO: audit
    res.status(200).json({
      status: 200,
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
    { reason: string; dateEnded: string } & Partial<ExperimentInterface>
  >,
  res: Response
) {
  if (!req.permissions.runExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id }: { id: string } = req.params;
  const { reason, results, analysis, winner, dateEnded } = req.body;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== req.organization.id) {
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
      dateEnded: new Date(dateEnded ? dateEnded + ":00Z" : undefined),
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

    await queueWebhook(req.organization.id);

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

export async function postExperimentPhase(
  req: AuthRequest<ExperimentPhase>,
  res: Response
) {
  if (!req.permissions.runExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id }: { id: string } = req.params;
  const { reason, dateStarted, ...data } = req.body;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  const date = new Date(dateStarted ? dateStarted + ":00Z" : undefined);

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
    dateEnded: null,
    reason: "",
  });

  // TODO: validation
  try {
    exp.set("phases", phases);
    await exp.save();

    await addGroupsDiff(req.organization.id, [], data.groups || []);

    await req.audit({
      event: isStarting ? "experiment.start" : "experiment.phase",
      entity: {
        object: "experiment",
        id: exp.id,
      },
      details: JSON.stringify(data),
    });

    await ensureWatching(req.userId, req.organization.id, exp.id);

    await queueWebhook(req.organization.id);

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

export async function watchExperiment(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;

  try {
    const exp = await getExperimentById(id);
    if (exp.organization !== req.organization.id) {
      res.status(403).json({
        status: 403,
        message: "You do not have access to this experiment",
      });
      return;
    }

    await ensureWatching(req.userId, req.organization.id, id);

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

export async function unwatchExperiment(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;

  try {
    await WatchModel.updateOne(
      {
        userId: req.userId,
        organization: req.organization.id,
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

export async function deleteMetric(req: AuthRequest, res: Response) {
  if (!req.permissions.createMetrics) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id }: { id: string } = req.params;

  const metric = await getMetricById(id, req.organization.id);

  if (!metric) {
    res.status(403).json({
      status: 404,
      message: "Metric not found",
    });
    return;
  }

  // note: we might want to change this to change the status to
  // 'deleted' instead of actually deleting the document.
  const del = await deleteMetricById(metric.id);

  res.status(200).json({
    status: 200,
    result: del,
  });
}

export async function deleteExperiment(
  req: AuthRequest<ExperimentInterface>,
  res: Response
) {
  const { id }: { id: string } = req.params;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== req.organization.id) {
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

  await queueWebhook(req.organization.id);

  res.status(200).json({
    status: 200,
  });
}

export async function getMetrics(req: AuthRequest, res: Response) {
  const metrics = await getMetricsByOrganization(req.organization.id);
  res.status(200).json({
    status: 200,
    metrics,
  });
}

async function getMetricAnalysis(
  metric: MetricInterface,
  queryData: QueryMap
): Promise<MetricAnalysis> {
  const metricData: MetricValueResult = queryData.get("metric")?.result || {};
  const usersData: UsersResult = (queryData.get("users")
    ?.result as UsersResult) || { users: 0 };

  let total = (metricData.count || 0) * (metricData.mean || 0);
  let count = metricData.count || 0;
  const dates: { d: Date; v: number }[] = [];

  // Calculate total from dates
  if (metricData.dates && usersData.dates) {
    total = 0;
    count = 0;

    // Map of date to user count
    const userDateMap: Map<string, number> = new Map();
    usersData.dates.forEach((u) => {
      userDateMap.set(u.date + "", u.users);
    });

    metricData.dates.forEach((d) => {
      const averageBase =
        (metric.ignoreNulls ? d.count : userDateMap.get(d.date + "")) || 0;
      const dateTotal = (d.count || 0) * (d.mean || 0);
      total += dateTotal;
      count += d.count || 0;
      dates.push({
        d: new Date(d.date),
        v: averageBase > 0 ? dateTotal / averageBase : 0,
      });
    });
  }

  const users = usersData.users || 0;
  const averageBase = metric.ignoreNulls ? count : users;
  const average = averageBase > 0 ? total / averageBase : 0;

  return {
    createdAt: new Date(),
    average,
    users,
    dates,
    percentiles: metricData.percentiles
      ? Object.keys(metricData.percentiles).map((k) => {
          return {
            p: parseInt(k) / 100,
            v: metricData.percentiles[k],
          };
        })
      : [],
  };
}

export async function getMetricAnalysisStatus(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;
  const metric = await getMetricById(id, req.organization.id, true, true);
  const result = await getStatusEndpoint(
    metric,
    req.organization.id,
    (queryData) => getMetricAnalysis(metric, queryData),
    async (updates, result?: MetricAnalysis) => {
      await updateMetric(
        id,
        result ? { ...updates, analysis: result } : updates,
        req.organization.id
      );
    }
  );
  return res.status(200).json(result);
}
export async function cancelMetricAnalysis(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;
  const metric = await getMetricById(id, req.organization.id, true, true);
  res.status(200).json(
    await cancelRun(metric, req.organization.id, async () => {
      await updateMetric(
        id,
        {
          queries: [],
          runStarted: null,
        },
        req.organization.id
      );
    })
  );
}

export async function postMetricAnalysis(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;

  const metric = await getMetricById(id, req.organization.id, true, true);

  if (!metric) {
    return res.status(404).json({
      status: 404,
      message: "Metric not found",
    });
  }

  try {
    if (metric.datasource) {
      const datasource = await getDataSourceById(
        metric.datasource,
        metric.organization
      );
      const integration = getSourceIntegrationObject(datasource);

      const from = new Date();
      from.setDate(from.getDate() - 90);
      const to = new Date();

      const baseParams: UsersQueryParams | MetricValueParams = {
        from,
        to,
        name: "Site-Wide",
        includeByDate: true,
        userIdType: metric.userIdType,
      };

      const updates: Partial<MetricInterface> = {};

      updates.runStarted = new Date();

      const { queries, result } = await startRun(
        {
          users: getUsers(integration, baseParams),
          metric: getMetricValue(integration, {
            ...baseParams,
            metric,
            includePercentiles: true,
          }),
        },
        (queryData) => getMetricAnalysis(metric, queryData)
      );

      updates.queries = queries;
      if (result) {
        updates.analysis = result;
      }

      await updateMetric(metric.id, updates, req.organization.id);
    } else {
      throw new Error("Cannot analyze manual metrics");
    }

    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}
export async function getMetric(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;

  const metric = await getMetricById(id, req.organization.id, false, true);

  if (!metric) {
    return res.status(404).json({
      status: 404,
      message: "Metric not found",
    });
  }

  if (!(await userHasAccess(req, metric.organization))) {
    return res.status(403).json({
      status: 403,
      message: "You do not have access to view this metric",
    });
  }

  const experiments = await ExperimentModel.find(
    {
      organization: req.organization.id,
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
    earlyStart,
    cap,
    conversionWindowHours,
    sql,
    tags,
    winRisk,
    loseRisk,
    minThresholdDisplay,
    minThresholdSignificance,
    conditions,
    datasource,
    timestampColumn,
    userIdType,
    userIdColumn,
    anonymousIdColumn,
  } = req.body;

  if (datasource) {
    const datasourceObj = await getDataSourceById(
      datasource,
      req.organization.id
    );
    if (!datasourceObj) {
      res.status(403).json({
        status: 403,
        message: "Invalid data source: " + datasource,
      });
      return;
    }
  }

  const metric = await createMetric({
    organization: req.organization.id,
    datasource,
    name,
    description,
    type,
    table,
    column,
    inverse,
    earlyStart,
    ignoreNulls,
    cap,
    conversionWindowHours,
    userIdType,
    sql,
    userIdColumn,
    anonymousIdColumn,
    timestampColumn,
    conditions,
    tags,
    winRisk,
    loseRisk,
    minThresholdDisplay,
    minThresholdSignificance,
  });

  res.status(200).json({
    status: 200,
    metric,
  });
}

export async function putMetric(
  req: AuthRequest<Partial<MetricInterface>>,
  res: Response
) {
  if (!req.permissions.createMetrics) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id }: { id: string } = req.params;
  const metric = await getMetricById(id, req.organization.id);

  const updates: Partial<MetricInterface> = {};

  const fields: (keyof MetricInterface)[] = [
    "name",
    "description",
    "type",
    "earlyStart",
    "inverse",
    "ignoreNulls",
    "cap",
    "conversionWindowHours",
    "sql",
    "tags",
    "winRisk",
    "loseRisk",
    "minThresholdDisplay",
    "minThresholdSignificance",
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

  await updateMetric(metric.id, updates, req.organization.id);

  await addTagsDiff(
    req.organization.id,
    metric.tags || [],
    req.body.tags || []
  );

  res.status(200).json({
    status: 200,
  });
}

export async function previewManualSnapshot(
  req: AuthRequest<{
    users: number[];
    metrics: { [key: string]: MetricStats[] };
  }>,
  res: Response
) {
  const { id, phase }: { id: string; phase: string } = req.params;

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

export async function getSnapshotStatus(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;
  const snapshot = await ExperimentSnapshotModel.findOne({ id });
  if (!snapshot) throw new Error("Unknown snapshot id");

  if (snapshot.organization !== req.organization?.id)
    throw new Error("You don't have access to that snapshot");

  const experiment = await ExperimentModel.findOne({
    id: snapshot.experiment,
  });
  if (!experiment) throw new Error("Invalid experiment id");

  const phase = experiment.phases[snapshot.phase];

  const result = await getStatusEndpoint(
    snapshot,
    req.organization.id,
    (queryData) => processSnapshotData(experiment, phase, queryData),
    async (updates, results) => {
      await ExperimentSnapshotModel.updateOne(
        {
          id,
        },
        {
          $set: {
            ...updates,
            unknownVariations:
              results?.unknownVariations || snapshot.unknownVariations || [],
            results: results?.dimensions || snapshot.results,
          },
        }
      );
    }
  );
  return res.status(200).json(result);
}
export async function cancelSnapshot(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;
  const snapshot = await ExperimentSnapshotModel.findOne({
    id,
    organization: req.organization.id,
  });
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "No snapshot found with that id",
    });
  }
  res.status(200).json(
    await cancelRun(snapshot, req.organization.id, async () => {
      await ExperimentSnapshotModel.deleteOne({
        id,
      });
    })
  );
}
export async function postSnapshot(
  req: AuthRequest<{
    phase: number;
    dimension?: string;
    users?: number[];
    metrics?: { [key: string]: MetricStats[] };
  }>,
  res: Response
) {
  if (!req.permissions.runExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  // This is doing an expensive analytics SQL query, so may take a long time
  // Set timeout to 30 minutes
  req.setTimeout(30 * 60 * 1000);

  const { id }: { id: string } = req.params;
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
    try {
      const snapshot = await createManualSnapshot(
        exp,
        phase,
        req.body.users,
        req.body.metrics
      );
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

  if (exp.organization !== req.organization.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this experiment",
    });
    return;
  }

  const datasource = await getDataSourceById(
    exp.datasource,
    req.organization.id
  );
  if (!datasource) {
    res.status(400).json({
      status: 404,
      message: "Data source not found",
    });
    return;
  }

  let userDimension: DimensionInterface;
  let experimentDimension: string;
  if (dimension) {
    if (dimension.match(/^exp:/)) {
      experimentDimension = dimension.substr(4);
    } else {
      userDimension = await findDimensionById(dimension, req.organization.id);
    }
  }

  try {
    const snapshot = await createSnapshot(
      exp,
      phase,
      datasource,
      userDimension,
      experimentDimension
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
  req: AuthRequest<{ url: string }>,
  res: Response
) {
  if (!req.permissions.draftExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id, variation }: { id: string; variation: number } = req.params;

  const { url } = req.body;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== req.organization.id) {
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
  req: AuthRequest<AddScreenshotRequestBody>,
  res: Response
) {
  if (!req.permissions.draftExperiments) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  const { id, variation }: { id: string; variation: number } = req.params;

  const { url, description } = req.body;

  const exp = await getExperimentById(id);

  if (!exp) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (exp.organization !== req.organization.id) {
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

  await ensureWatching(req.userId, req.organization.id, exp.id);

  res.status(200).json({
    status: 200,
    screenshot: {
      path: url,
      description: description,
    },
  });
}

export async function getPastExperimentStatus(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;
  const model = await PastExperimentsModel.findOne({ id });
  const result = await getStatusEndpoint(
    model,
    req.organization.id,
    processPastExperiments,
    async (updates, experiments) => {
      await PastExperimentsModel.updateOne(
        { id },
        {
          $set: {
            ...updates,
            experiments,
          },
        }
      );
    }
  );
  return res.status(200).json(result);
}
export async function cancelPastExperiments(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;
  const model = await PastExperimentsModel.findOne({
    id,
    organization: req.organization.id,
  });
  res.status(200).json(
    await cancelRun(model, req.organization.id, async () => {
      model.set("queries", []);
      model.set("runStarted", null);
      await model.save();
    })
  );
}

export async function getPastExperimentsList(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;
  const model = await PastExperimentsModel.findOne({
    id,
    organization: req.organization.id,
  });

  if (!model) {
    throw new Error("Invalid import id");
  }

  const experiments = await ExperimentModel.find(
    {
      organization: req.organization.id,
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
  const { datasource, force } = req.body;

  const datasourceObj = await getDataSourceById(
    datasource,
    req.organization.id
  );
  if (!datasourceObj) {
    throw new Error("Could not find datasource");
  }

  const integration = getSourceIntegrationObject(datasourceObj);
  const start = new Date();
  start.setDate(start.getDate() - 365);
  const now = new Date();

  let model = await PastExperimentsModel.findOne({
    datasource,
    organization: req.organization.id,
  });
  if (!model) {
    const { queries, result } = await startRun(
      {
        experiments: getPastExperiments(
          integration,
          start,
          req.organization?.settings?.pastExperimentsMinLength
        ),
      },
      processPastExperiments
    );
    model = await PastExperimentsModel.create({
      id: uniqid("imp_"),
      organization: req.organization.id,
      datasource: datasource,
      experiments: result || [],
      runStarted: now,
      queries,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  } else if (force) {
    const { queries, result } = await startRun(
      {
        experiments: getPastExperiments(
          integration,
          start,
          req.organization?.settings?.pastExperimentsMinLength
        ),
      },
      processPastExperiments
    );
    model.set("runStarted", now);
    model.set("queries", queries);
    if (result) {
      model.set("experiments", result);
    }
    await model.save();
  }

  res.status(200).json({
    status: 200,
    id: model.id,
  });
}
