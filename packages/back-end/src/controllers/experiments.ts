import { Response } from "express";
import uniqid from "uniqid";
import format from "date-fns/format";
import cloneDeep from "lodash/cloneDeep";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { getValidDate } from "shared/dates";
import { getAffectedEnvsForExperiment } from "shared/util";
import { getScopedSettings } from "shared/settings";
import { orgHasPremiumFeature } from "enterprise";
import { AuthRequest, ResponseWithStatusAndError } from "../types/AuthRequest";
import {
  createManualSnapshot,
  createSnapshot,
  ensureWatching,
  getExperimentWatchers,
  getManualSnapshotData,
} from "../services/experiments";
import { MetricStats } from "../../types/metric";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  getAllExperiments,
  getExperimentById,
  getExperimentByTrackingKey,
  getPastExperimentsByDatasource,
  updateExperiment,
} from "../models/ExperimentModel";
import {
  createVisualChangeset,
  deleteVisualChangesetById,
  findVisualChangesetById,
  findVisualChangesetsByExperiment,
  syncVisualChangesWithVariations,
  updateVisualChangeset,
} from "../models/VisualChangesetModel";
import {
  deleteSnapshotById,
  findSnapshotById,
  getLatestSnapshot,
  updateSnapshotsOnPhaseDelete,
} from "../models/ExperimentSnapshotModel";
import {
  getIntegrationFromDatasourceId,
  getSourceIntegrationObject,
} from "../services/datasource";
import { addTagsDiff } from "../models/TagModel";
import { getOrgFromReq, userHasAccess } from "../services/organizations";
import { removeExperimentFromPresentations } from "../services/presentations";
import {
  createPastExperiments,
  getPastExperimentsById,
  getPastExperimentsModelByDatasource,
  updatePastExperiments,
} from "../models/PastExperimentsModel";
import {
  Changeset,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
  ExperimentStatus,
  Variation,
} from "../../types/experiment";
import { getMetricById, getMetricMap } from "../models/MetricModel";
import { IdeaModel } from "../models/IdeasModel";
import { IdeaInterface } from "../../types/idea";
import { getDataSourceById } from "../models/DataSourceModel";
import { generateExperimentNotebook } from "../services/notebook";
import { IMPORT_LIMIT_DAYS } from "../util/secrets";
import { getAllFeatures } from "../models/FeatureModel";
import { ExperimentRule, FeatureInterface } from "../../types/feature";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../services/audit";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "../../types/experiment-snapshot";
import { StatsEngine } from "../../types/stats";
import { MetricRegressionAdjustmentStatus } from "../../types/report";
import { VisualChangesetInterface } from "../../types/visual-changeset";
import { PrivateApiErrorResponse } from "../../types/api";
import { EventAuditUserForResponseLocals } from "../events/event-types";
import { findProjectById } from "../models/ProjectModel";
import { ExperimentResultsQueryRunner } from "../queryRunners/ExperimentResultsQueryRunner";
import { PastExperimentsQueryRunner } from "../queryRunners/PastExperimentsQueryRunner";

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

  const visualChangesets = await findVisualChangesetsByExperiment(
    experiment.id,
    org.id
  );

  res.status(200).json({
    status: 200,
    experiment,
    visualChangesets,
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
  res: Response<
    | { status: 200; experiment: ExperimentInterface }
    | { status: 200; duplicateTrackingKey: boolean; existingId: string }
    | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
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
    attributionModel: data.attributionModel || "firstExposure",
    variations: data.variations || [],
    implementation: data.implementation || "code",
    status: data.status || "draft",
    results: data.results || undefined,
    analysis: data.analysis || "",
    releasedVariationId: "",
    excludeFromPayload: true,
    autoAssign: data.autoAssign || false,
    previewURL: data.previewURL || "",
    targetURLRegex: data.targetURLRegex || "",
    ideaSource: data.ideaSource || "",
    // todo: revisit this logic for project level settings, as well as "override stats settings" toggle:
    sequentialTestingEnabled:
      data.sequentialTestingEnabled ??
      !!org?.settings?.sequentialTestingEnabled,
    sequentialTestingTuningParameter:
      data.sequentialTestingTuningParameter ??
      org?.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
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

    const experiment = await createExperiment({
      data: obj,
      organization: org,
      user: res.locals.eventAudit,
    });

    await req.audit({
      event: "experiment.create",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate(experiment),
    });

    await ensureWatching(userId, org.id, experiment.id, "experiments");

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
  res: Response<
    | { status: number; experiment?: ExperimentInterface | null }
    | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
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
    "excludeFromPayload",
    "autoSnapshots",
    "project",
    "regressionAdjustmentEnabled",
    "hasVisualChangesets",
    "sequentialTestingEnabled",
    "sequentialTestingTuningParameter",
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

  // Only some fields affect production SDK payloads
  const needsRunExperimentsPermission = ([
    "phases",
    "variations",
    "project",
    "name",
    "trackingKey",
    "archived",
    "status",
    "releasedVariationId",
    "excludeFromPayload",
  ] as (keyof ExperimentInterfaceStringDates)[]).some((key) => key in changes);
  if (needsRunExperimentsPermission) {
    const envs = getAffectedEnvsForExperiment({
      experiment,
    });
    if (envs.length > 0) {
      const projects = [experiment.project || undefined];
      if ("project" in changes) {
        projects.push(changes.project || undefined);
      }
      req.checkPermissions("runExperiments", projects, envs);
    }
  }

  const updated = await updateExperiment({
    organization: org,
    experiment,
    user: res.locals.eventAudit,
    changes,
  });

  // if variations have changed, update the experiment's visualchangesets if they exist
  if (changes.variations && updated) {
    const visualChangesets = await findVisualChangesetsByExperiment(
      experiment.id,
      org.id
    );

    if (visualChangesets.length) {
      await Promise.all(
        visualChangesets.map((vc) =>
          syncVisualChangesWithVariations({
            visualChangeset: vc,
            experiment: updated,
            organization: org,
            user: res.locals.eventAudit,
          })
        )
      );
    }
  }

  await req.audit({
    event: "experiment.update",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment, updated),
  });

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

  const envs = getAffectedEnvsForExperiment({
    experiment,
  });
  envs.length > 0 &&
    req.checkPermissions("runExperiments", experiment.project, envs);

  changes.archived = true;

  try {
    await updateExperiment({
      organization: org,
      experiment,
      user: res.locals.eventAudit,
      changes,
    });

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
    await updateExperiment({
      organization: org,
      experiment,
      user: res.locals.eventAudit,
      changes,
    });

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

  const envs = getAffectedEnvsForExperiment({
    experiment,
  });
  envs.length > 0 &&
    req.checkPermissions("runExperiments", experiment.project, envs);

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

  const updated = await updateExperiment({
    organization: org,
    experiment,
    user: res.locals.eventAudit,
    changes,
  });

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
    excludeFromPayload,
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

  const envs = getAffectedEnvsForExperiment({
    experiment,
  });
  envs.length > 0 &&
    req.checkPermissions("runExperiments", experiment.project, envs);

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
  changes.excludeFromPayload = !!excludeFromPayload;

  try {
    const updated = await updateExperiment({
      organization: org,
      experiment,
      user: res.locals.eventAudit,
      changes,
    });

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

  const envs = getAffectedEnvsForExperiment({
    experiment,
  });
  envs.length > 0 &&
    req.checkPermissions("runExperiments", experiment.project, envs);

  if (phaseIndex < 0 || phaseIndex >= experiment.phases?.length) {
    throw new Error("Invalid phase id");
  }

  // Remove an element from an array without mutating the original
  changes.phases = experiment.phases.filter((phase, i) => i !== phaseIndex);

  if (!changes.phases.length) {
    changes.status = "draft";
  }
  const updated = await updateExperiment({
    organization: org,
    experiment,
    user: res.locals.eventAudit,
    changes,
  });

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

  if (!experiment.phases?.[i]) {
    throw new Error("Invalid phase");
  }

  req.checkPermissions("createAnalyses", experiment.project);

  const envs = getAffectedEnvsForExperiment({
    experiment,
  });
  envs.length > 0 &&
    req.checkPermissions("runExperiments", experiment.project, envs);

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
  const updated = await updateExperiment({
    organization: org,
    experiment,
    user: res.locals.eventAudit,
    changes,
  });

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

  const envs = getAffectedEnvsForExperiment({
    experiment,
  });
  envs.length > 0 &&
    req.checkPermissions("runExperiments", experiment.project, envs);

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
    const updated = await updateExperiment({
      organization: org,
      experiment,
      user: res.locals.eventAudit,
      changes,
    });

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
  res: Response<
    { status: 200 } | PrivateApiErrorResponse,
    EventAuditUserForResponseLocals
  >
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

  const envs = getAffectedEnvsForExperiment({
    experiment,
  });
  envs.length > 0 &&
    req.checkPermissions("runExperiments", experiment.project, envs);

  await Promise.all([
    // note: we might want to change this to change the status to
    // 'deleted' instead of actually deleting the document.
    deleteExperimentByIdForOrganization(experiment, org, res.locals.eventAudit),
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
    const metricMap = await getMetricMap(org.id);

    const data = await getManualSnapshotData(
      experiment,
      phaseIndex,
      req.body.users,
      req.body.metrics,
      metricMap
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

  const integration = await getIntegrationFromDatasourceId(
    snapshot.organization,
    snapshot.settings.datasourceId
  );
  const queryRunner = new ExperimentResultsQueryRunner(snapshot, integration);
  await queryRunner.cancelQueries();
  await deleteSnapshotById(org.id, snapshot.id);

  res.status(200).json({ status: 200 });
}
export async function postSnapshot(
  req: AuthRequest<
    {
      phase: number;
      dimension?: string;
      users?: number[];
      metrics?: { [key: string]: MetricStats[] };
      statsEngine?: StatsEngine;
      regressionAdjustmentEnabled?: boolean;
      metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
    },
    { id: string },
    { force?: string }
  >,
  res: Response
) {
  req.checkPermissions("runQueries", "");

  const { org } = getOrgFromReq(req);
  const orgSettings = org.settings || {};

  let { statsEngine, regressionAdjustmentEnabled } = req.body;
  const { metricRegressionAdjustmentStatuses } = req.body;
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

  let project = null;
  if (experiment.project) {
    project = await findProjectById(experiment.project, org.id);
  }
  const { settings: scopedSettings } = getScopedSettings({
    organization: org,
    project: project ?? undefined,
  });

  statsEngine = ["bayesian", "frequentist"].includes(statsEngine + "")
    ? statsEngine
    : scopedSettings.statsEngine.value;

  const hasRegressionAdjustmentFeature = org
    ? orgHasPremiumFeature(org, "regression-adjustment")
    : false;
  const hasSequentialTestingFeature = org
    ? orgHasPremiumFeature(org, "sequential-testing")
    : false;

  regressionAdjustmentEnabled =
    hasRegressionAdjustmentFeature &&
    statsEngine === "frequentist" &&
    (regressionAdjustmentEnabled !== undefined
      ? regressionAdjustmentEnabled
      : orgSettings?.regressionAdjustmentEnabled ?? false);

  const sequentialTestingEnabled =
    hasSequentialTestingFeature &&
    statsEngine === "frequentist" &&
    (experiment?.sequentialTestingEnabled ??
      !!orgSettings?.sequentialTestingEnabled);
  const sequentialTestingTuningParameter =
    experiment?.sequentialTestingTuningParameter ??
    orgSettings?.sequentialTestingTuningParameter ??
    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;

  const useCache = !req.query["force"];

  // This is doing an expensive analytics SQL query, so may take a long time
  // Set timeout to 30 minutes
  req.setTimeout(30 * 60 * 1000);

  const analysisSettings: ExperimentSnapshotAnalysisSettings = {
    statsEngine: statsEngine as StatsEngine,
    regressionAdjusted: !!regressionAdjustmentEnabled,
    dimensions: dimension ? [dimension] : [],
    sequentialTesting: !!sequentialTestingEnabled,
    sequentialTestingTuningParameter,
  };

  const metricMap = await getMetricMap(org.id);

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
        analysisSettings,
        metricMap
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
    const queryRunner = await createSnapshot({
      experiment,
      organization: org,
      user: res.locals.eventAudit,
      phaseIndex: phase,
      useCache,
      analysisSettings,
      metricRegressionAdjustmentStatuses:
        metricRegressionAdjustmentStatuses || [],
      metricMap,
    });
    const snapshot = queryRunner.model;

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
  const updated = await updateExperiment({
    organization: org,
    experiment,
    user: res.locals.eventAudit,
    changes,
  });

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

  await updateExperiment({
    organization: org,
    experiment,
    user: res.locals.eventAudit,
    changes,
  });

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

export async function cancelPastExperiments(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("runQueries", "");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const pastExperiments = await getPastExperimentsById(org.id, id);
  if (!pastExperiments) {
    throw new Error("Could not cancel query");
  }

  const integration = await getIntegrationFromDatasourceId(
    pastExperiments.organization,
    pastExperiments.datasource
  );
  const queryRunner = new PastExperimentsQueryRunner(
    pastExperiments,
    integration
  );
  await queryRunner.cancelQueries();

  res.status(200).json({ status: 200 });
}

export async function getPastExperimentsList(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const pastExperiments = await getPastExperimentsById(org.id, id);

  if (!pastExperiments) {
    throw new Error("Invalid import id");
  }

  const experiments = await getPastExperimentsByDatasource(
    org.id,
    pastExperiments.datasource
  );

  const experimentMap = new Map<string, string>();
  (experiments || []).forEach((e) => {
    experimentMap.set(e.trackingKey, e.id);
  });

  const trackingKeyMap: Record<string, string> = {};
  (pastExperiments.experiments || []).forEach((e) => {
    const id = experimentMap.get(e.trackingKey);
    if (id) {
      trackingKeyMap[e.trackingKey] = id;
    }
  });

  res.status(200).json({
    status: 200,
    experiments: pastExperiments,
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

  const integration = getSourceIntegrationObject(datasourceObj, true);

  let pastExperiments = await getPastExperimentsModelByDatasource(
    org.id,
    datasource
  );

  const start = new Date();
  start.setDate(start.getDate() - IMPORT_LIMIT_DAYS);

  let needsRun = false;
  if (!pastExperiments) {
    pastExperiments = await createPastExperiments({
      organization: org.id,
      datasource,
      experiments: [],
      start,
      queries: [],
    });
    needsRun = true;
  }

  if (force) {
    needsRun = true;
    pastExperiments = await updatePastExperiments(pastExperiments, {
      config: {
        start,
        end: new Date(),
      },
    });
  }

  if (needsRun) {
    const queryRunner = new PastExperimentsQueryRunner(
      pastExperiments,
      integration
    );
    pastExperiments = await queryRunner.startAnalysis({
      from: start,
    });
  }

  res.status(200).json({
    status: 200,
    id: pastExperiments.id,
  });

  if (needsRun) {
    await req.audit({
      event: "datasource.import",
      entity: {
        object: "datasource",
        id: datasource,
      },
    });
  }
}

export async function postVisualChangeset(
  req: AuthRequest<Partial<VisualChangesetInterface>, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  if (!req.body.urlPatterns) {
    throw new Error("urlPatterns needs to be defined");
  }

  if (!req.body.editorUrl) {
    throw new Error("editorUrl needs to be defined");
  }

  const experiment = await getExperimentById(org.id, req.params.id);

  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const envs = getAffectedEnvsForExperiment({
    experiment,
  });
  envs.length > 0 &&
    req.checkPermissions("runExperiments", experiment.project, envs);

  const visualChangeset = await createVisualChangeset({
    experiment,
    urlPatterns: req.body.urlPatterns,
    editorUrl: req.body.editorUrl,
    organization: org,
    user: res.locals.eventAudit,
  });

  res.status(200).json({
    status: 200,
    visualChangeset,
  });
}

export async function putVisualChangeset(
  req: AuthRequest<Partial<VisualChangesetInterface>, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const visualChangeset = await findVisualChangesetById(req.params.id, org.id);
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const experiment = await getExperimentById(
    org.id,
    visualChangeset.experiment
  );

  const envs = experiment ? getAffectedEnvsForExperiment({ experiment }) : [];
  req.checkPermissions("runExperiments", experiment?.project || "", envs);

  const ret = await updateVisualChangeset({
    visualChangeset,
    experiment,
    organization: org,
    updates: req.body,
    user: res.locals.eventAudit,
  });

  res.status(200).json({
    status: 200,
    data: {
      nModified: ret.nModified,
      changesetId: ret.nModified > 0 ? req.params.id : undefined,
      updates: ret.nModified > 0 ? req.body : undefined,
    },
  });
}

export async function deleteVisualChangeset(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const visualChangeset = await findVisualChangesetById(req.params.id, org.id);
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const experiment = await getExperimentById(
    org.id,
    visualChangeset.experiment
  );

  const envs = experiment ? getAffectedEnvsForExperiment({ experiment }) : [];
  req.checkPermissions("runExperiments", experiment?.project || "", envs);

  await deleteVisualChangesetById({
    visualChangeset,
    experiment,
    organization: org,
    user: res.locals.eventAudit,
  });

  res.status(200).json({
    status: 200,
  });
}
