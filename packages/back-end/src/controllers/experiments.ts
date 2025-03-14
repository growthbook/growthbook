import { Response } from "express";
import uniqid from "uniqid";
import format from "date-fns/format";
import cloneDeep from "lodash/cloneDeep";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { getValidDate } from "shared/dates";
import {
  getAffectedEnvsForExperiment,
  getSnapshotAnalysis,
  isDefined,
} from "shared/util";
import {
  getAllMetricIdsFromExperiment,
  getAllMetricSettingsForSnapshot,
} from "shared/experiments";
import { getScopedSettings } from "shared/settings";
import { v4 as uuidv4 } from "uuid";
import uniq from "lodash/uniq";
import { DataSourceInterface } from "back-end/types/datasource";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import {
  _getSnapshots,
  createManualSnapshot,
  createSnapshot,
  createSnapshotAnalyses,
  createSnapshotAnalysis,
  determineNextBanditSchedule,
  getAdditionalExperimentAnalysisSettings,
  getChangesToStartExperiment,
  getDefaultExperimentAnalysisSettings,
  getLinkedFeatureInfo,
  resetExperimentBanditSettings,
  SnapshotAnalysisParams,
  updateExperimentBanditSettings,
} from "back-end/src/services/experiments";
import { MetricInterface, MetricStats } from "back-end/types/metric";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  getAllExperiments,
  getExperimentById,
  getExperimentByTrackingKey,
  getExperimentByUid,
  getExperimentsByIds,
  getPastExperimentsByDatasource,
  hasArchivedExperiments,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  createVisualChangeset,
  deleteVisualChangesetById,
  findVisualChangesetById,
  findVisualChangesetsByExperiment,
  syncVisualChangesWithVariations,
  updateVisualChangeset,
} from "back-end/src/models/VisualChangesetModel";
import {
  deleteSnapshotById,
  findSnapshotById,
  getAllSnapshotsForTimeSeries,
  getLatestSnapshot,
  updateSnapshot,
  updateSnapshotsOnPhaseDelete,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { addTagsDiff } from "back-end/src/models/TagModel";
import {
  getContextForAgendaJobByOrgId,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { removeExperimentFromPresentations } from "back-end/src/services/presentations";
import {
  createPastExperiments,
  getPastExperimentsById,
  getPastExperimentsModelByDatasource,
  updatePastExperiments,
} from "back-end/src/models/PastExperimentsModel";
import {
  Changeset,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
  ExperimentStatus,
  ExperimentTargetingData,
  ExperimentType,
  Variation,
} from "back-end/types/experiment";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { IdeaModel } from "back-end/src/models/IdeasModel";
import { IdeaInterface } from "back-end/types/idea";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { generateExperimentNotebook } from "back-end/src/services/notebook";
import { IMPORT_LIMIT_DAYS } from "back-end/src/util/secrets";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  SnapshotTriggeredBy,
  SnapshotType,
} from "back-end/types/experiment-snapshot";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { ApiReqContext, PrivateApiErrorResponse } from "back-end/types/api";
import { EventUserForResponseLocals } from "back-end/src/events/event-types";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { PastExperimentsQueryRunner } from "back-end/src/queryRunners/PastExperimentsQueryRunner";
import {
  createUserVisualEditorApiKey,
  getVisualEditorApiKey,
} from "back-end/src/models/ApiKeyModel";

import {
  getExperimentWatchers,
  upsertWatch,
} from "back-end/src/models/WatchModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { OrganizationSettings, ReqContext } from "back-end/types/organization";
import { CreateURLRedirectProps } from "back-end/types/url-redirect";
import { logger } from "back-end/src/util/logger";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { generateExperimentReportSSRData } from "back-end/src/services/reports";
import { updateExperimentTimeSeries } from "back-end/src/services/experimentTimeSeries";

export const SNAPSHOT_TIMEOUT = 30 * 60 * 1000;

export async function getExperiments(
  req: AuthRequest<
    unknown,
    unknown,
    {
      project?: string;
      includeArchived?: boolean;
      type?: ExperimentType;
    }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const includeArchived = !!req.query?.includeArchived;
  const type: ExperimentType | undefined = req.query?.type || undefined;

  const experiments = await getAllExperiments(context, {
    project,
    includeArchived,
    type,
  });

  const hasArchived = includeArchived
    ? experiments.some((e) => e.archived)
    : await hasArchivedExperiments(context, project);

  res.status(200).json({
    status: 200,
    experiments,
    hasArchived,
  });
}

export async function getExperimentsFrequencyMonth(
  req: AuthRequest<null, { num: string }, { project?: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const allProjects = await context.models.projects.getAll();
  const { num } = req.params;
  const experiments = await getAllExperiments(context, {
    project,
    includeArchived: true,
  });

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

  // create stubs for each month by all the projects:
  const dataByProject: Record<string, [{ date: string; numExp: number }]> = {};
  allProjects.forEach((p) => {
    dataByProject[p.id] = JSON.parse(JSON.stringify(allData));
  });
  dataByProject["all"] = JSON.parse(JSON.stringify(allData));

  // create stubs for each month by all the result:
  const dataByResult = {
    won: JSON.parse(JSON.stringify(allData)),
    lost: JSON.parse(JSON.stringify(allData)),
    inconclusive: JSON.parse(JSON.stringify(allData)),
    dnf: JSON.parse(JSON.stringify(allData)),
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

        // experiments without a project or with a deleted project
        // are included in the 'all projects'
        if (e.project && dataByProject[e.project]) {
          dataByProject[e.project][i].numExp++;
        } else {
          dataByProject["all"][i].numExp++;
        }

        if (e.results) {
          dataByResult[e.results][i].numExp++;
        }
      }
    });
  });

  res.status(200).json({
    status: 200,
    all: allData,
    byStatus: { ...dataByStatus },
    byProject: { ...dataByProject },
    byResults: { ...dataByResult },
  });
}

export async function lookupExperimentByTrackingKey(
  req: AuthRequest<unknown, unknown, { trackingKey: string }>,
  res: ResponseWithStatusAndError<{ experimentId: string | null }>
) {
  const context = getContextFromReq(req);
  const { trackingKey } = req.query;

  if (!trackingKey) {
    return res.status(400).json({
      status: 400,
      message: "Tracking key cannot be empty",
    });
  }

  const experiment = await getExperimentByTrackingKey(
    context,
    trackingKey + ""
  );

  return res.status(200).json({
    status: 200,
    experimentId: experiment?.id || null,
  });
}

export async function getExperiment(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    res.status(403).json({
      status: 404,
      message: "Experiment not found",
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

  const urlRedirects = await context.models.urlRedirects.findByExperiment(
    experiment.id
  );

  const linkedFeatureInfo = await getLinkedFeatureInfo(context, experiment);

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  res.status(200).json({
    status: 200,
    experiment,
    visualChangesets,
    urlRedirects,
    linkedFeatures: linkedFeatureInfo,
    envs,
    idea,
  });
}

export async function getExperimentPublic(
  req: AuthRequest<null, { uid: string }>,
  res: Response
) {
  const { uid } = req.params;
  const experiment = await getExperimentByUid(uid);
  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
  }
  if (experiment.shareLevel !== "public") {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const context = await getContextForAgendaJobByOrgId(experiment.organization);
  const phase = experiment.phases.length - 1;

  const snapshot =
    (await getLatestSnapshot({
      experiment: experiment.id,
      phase,
      type: "standard",
    })) || undefined;

  const visualChangesets = await findVisualChangesetsByExperiment(
    experiment.id,
    experiment.organization
  );

  const urlRedirects = await context.models.urlRedirects.findByExperiment(
    experiment.id
  );

  const linkedFeatures = await getLinkedFeatureInfo(context, experiment);

  const ssrData = await generateExperimentReportSSRData({
    context,
    organization: experiment.organization,
    project: experiment.project,
    snapshot,
  });

  res.status(200).json({
    status: 200,
    experiment,
    snapshot,
    visualChangesets,
    urlRedirects,
    linkedFeatures,
    ssrData,
  });
}

async function _getSnapshot({
  context,
  experiment,
  phase,
  dimension,
  withResults = true,
  type,
}: {
  context: ReqContext | ApiReqContext;
  experiment: string;
  phase?: string;
  dimension?: string;
  withResults?: boolean;
  type?: SnapshotType;
}) {
  const experimentObj = await getExperimentById(context, experiment);

  if (!experimentObj) {
    throw new Error("Experiment not found");
  }

  if (experimentObj.organization !== context.org.id) {
    throw new Error("You do not have access to view this experiment");
  }

  if (!phase) {
    // get the latest phase:
    phase = String(experimentObj.phases.length - 1);
  }

  return await getLatestSnapshot({
    experiment: experimentObj.id,
    phase: parseInt(phase),
    dimension,
    withResults,
    type,
  });
}

export async function getSnapshotWithDimension(
  req: AuthRequest<
    null,
    { id: string; phase: string; dimension: string },
    { type?: SnapshotType }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id, phase, dimension } = req.params;
  const type = req.query?.type || undefined;

  const snapshot = await _getSnapshot({
    context,
    experiment: id,
    phase,
    dimension,
    type,
  });
  const latest = await _getSnapshot({
    context,
    experiment: id,
    phase,
    dimension,
    withResults: false,
    type,
  });
  const dimensionless =
    snapshot?.dimension === ""
      ? snapshot
      : await _getSnapshot({
          context,
          experiment: id,
          phase,
          type,
        });

  res.status(200).json({
    status: 200,
    snapshot,
    latest,
    dimensionless,
  });
}
export async function getSnapshot(
  req: AuthRequest<
    null,
    { id: string; phase: string },
    { type?: SnapshotType }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id, phase } = req.params;
  const type = req.query?.type || undefined;

  const snapshot = await _getSnapshot({ context, experiment: id, phase, type });
  const latest = await _getSnapshot({
    context,
    experiment: id,
    phase,
    withResults: false,
    type,
  });

  res.status(200).json({
    status: 200,
    snapshot,
    latest,
  });
}

export async function getSnapshotById(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const { id } = req.params;

  const snapshot = await findSnapshotById(org.id, id);
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "No snapshot found with that id",
    });
  }

  res.status(200).json({
    status: 200,
    snapshot,
  });
}

export async function postSnapshotNotebook(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const notebook = await generateExperimentNotebook(context, id);

  res.status(200).json({
    status: 200,
    notebook,
  });
}

export async function getSnapshots(
  req: AuthRequest<unknown, unknown, { experiments?: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const idsString = (req.query?.experiments as string) || "";
  if (!idsString.length) {
    res.status(200).json({
      status: 200,
      snapshots: [],
    });
    return;
  }

  const ids = idsString.split(",");
  const experimentObjs = await getExperimentsByIds(context, ids);
  const snapshots = await _getSnapshots(context, experimentObjs);

  res.status(200).json({
    status: 200,
    snapshots: snapshots,
  });
  return;
}

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
 * If based on another experiment (originalId), it will copy the visual changesets
 * @param req
 * @param res
 */
export async function postExperiments(
  req: AuthRequest<
    Partial<ExperimentInterfaceStringDates>,
    unknown,
    {
      allowDuplicateTrackingKey?: boolean;
      originalId?: string;
      autoRefreshResults?: boolean;
    }
  >,
  res: Response<
    | { status: 200; experiment: ExperimentInterface }
    | { status: 200; duplicateTrackingKey: boolean; existingId: string }
    | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;

  const data = req.body;
  data.organization = org.id;

  if (!context.permissions.canCreateExperiment(data)) {
    context.permissions.throwPermissionError();
  }

  let datasource: DataSourceInterface | null = null;
  if (data.datasource) {
    datasource = await getDataSourceById(context, data.datasource);
    if (!datasource) {
      res.status(403).json({
        status: 403,
        message: "Invalid datasource: " + data.datasource,
      });
      return;
    }
  }

  // Validate that specified metrics exist and belong to the organization
  const metricIds = getAllMetricIdsFromExperiment(data);
  if (metricIds.length) {
    const map = await getMetricMap(context);
    for (let i = 0; i < metricIds.length; i++) {
      const metric = map.get(metricIds[i]);
      if (metric) {
        // Make sure it is tied to the same datasource as the experiment
        if (data.datasource && metric.datasource !== data.datasource) {
          res.status(400).json({
            status: 400,
            message:
              "Metrics must be tied to the same datasource as the experiment: " +
              metricIds[i],
          });
          return;
        }
      } else {
        // check to see if this metric is actually a metric group
        const metricGroup = await context.models.metricGroups.getById(
          metricIds[i]
        );
        if (metricGroup) {
          // Make sure it is tied to the same datasource as the experiment
          if (data.datasource && metricGroup.datasource !== data.datasource) {
            res.status(400).json({
              status: 400,
              message:
                "Metric group must be tied to the same datasource as the experiment: " +
                metricIds[i],
            });
            return;
          }
        } else {
          // new metric that's not recognized...
          res.status(403).json({
            status: 403,
            message: "Unknown metric: " + metricIds[i],
          });
          return;
        }
      }
    }
  }

  const experimentType = data.type ?? "standard";

  const obj: Omit<ExperimentInterface, "id" | "uid"> = {
    organization: data.organization,
    archived: false,
    hashAttribute: data.hashAttribute || "",
    fallbackAttribute: data.fallbackAttribute || "",
    disableStickyBucketing: data.disableStickyBucketing ?? false,
    hashVersion: data.hashVersion || 2,
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
    phases: data.phases
      ? data.phases.map(({ dateStarted, dateEnded, ...phase }) => {
          return {
            ...phase,
            dateStarted: dateStarted ? getValidDate(dateStarted) : new Date(),
            dateEnded: dateEnded ? getValidDate(dateEnded) : undefined,
          };
        })
      : [],
    tags: data.tags || [],
    description: data.description || "",
    hypothesis: data.hypothesis || "",
    goalMetrics: data.goalMetrics || [],
    secondaryMetrics: data.secondaryMetrics || [],
    metricOverrides: data.metricOverrides || [],
    guardrailMetrics: data.guardrailMetrics || [],
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
      experimentType === "multi-armed-bandit"
        ? false
        : data.sequentialTestingEnabled ??
          !!org?.settings?.sequentialTestingEnabled,
    sequentialTestingTuningParameter:
      data.sequentialTestingTuningParameter ??
      org?.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    regressionAdjustmentEnabled: data.regressionAdjustmentEnabled ?? undefined,
    statsEngine:
      experimentType === "multi-armed-bandit" ? "bayesian" : data.statsEngine,
    type: experimentType,
    banditScheduleValue: data.banditScheduleValue ?? 1,
    banditScheduleUnit: data.banditScheduleUnit ?? "days",
    banditBurnInValue: data.banditBurnInValue ?? 1,
    banditBurnInUnit: data.banditBurnInUnit ?? "days",
    customFields: data.customFields || undefined,
    templateId: data.templateId || undefined,
    shareLevel: data.shareLevel || "organization",
  };

  const { settings } = getScopedSettings({
    organization: org,
  });

  try {
    validateVariationIds(obj.variations);

    // Make sure id is unique
    if (obj.trackingKey && !req.query.allowDuplicateTrackingKey) {
      const existing = await getExperimentByTrackingKey(
        context,
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

    if (experimentType === "multi-armed-bandit") {
      Object.assign(
        obj,
        resetExperimentBanditSettings({
          experiment: obj,
          settings,
        })
      );
    }

    const experiment = await createExperiment({
      data: obj,
      context,
    });

    if (req.query.originalId) {
      const visualChangesets = await findVisualChangesetsByExperiment(
        req.query.originalId,
        org.id
      );
      for (const visualChangeset of visualChangesets) {
        await createVisualChangeset({
          experiment,
          urlPatterns: visualChangeset.urlPatterns,
          editorUrl: visualChangeset.editorUrl,
          context,
          visualChanges: visualChangeset.visualChanges,
        });
      }

      const urlRedirects = await context.models.urlRedirects.findByExperiment(
        req.query.originalId
      );
      for (const urlRedirect of urlRedirects) {
        const props: CreateURLRedirectProps = {
          experiment: experiment.id,
          destinationURLs: urlRedirect.destinationURLs,
          persistQueryString: urlRedirect.persistQueryString,
          urlPattern: urlRedirect.urlPattern,
        };
        await context.models.urlRedirects.create(props);
      }
    }

    if (datasource && req.query.autoRefreshResults && metricIds.length > 0) {
      // This is doing an expensive analytics SQL query, so may take a long time
      // Set timeout to 30 minutes
      req.setTimeout(SNAPSHOT_TIMEOUT);

      try {
        await createExperimentSnapshot({
          context,
          experiment,
          datasource,
          dimension: "",
          phase: 0,
          useCache: true,
        });
      } catch (e) {
        logger.error(e, "Failed to auto-refresh imported experiment");
      }
    }

    await req.audit({
      event: "experiment.create",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate(experiment),
    });

    await upsertWatch({
      userId,
      organization: org.id,
      item: experiment.id,
      type: "experiments",
    });

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
      variationWeights?: number[];
    },
    { id: string }
  >,
  res: Response<
    | { status: number; experiment?: ExperimentInterface | null }
    | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { id } = req.params;
  const { phaseStartDate, phaseEndDate, currentPhase, ...data } = req.body;

  const experiment = await getExperimentById(context, id);

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

  if (!context.permissions.canUpdateExperiment(experiment, req.body)) {
    context.permissions.throwPermissionError();
  }

  const { settings } = getScopedSettings({
    organization: org,
    experiment,
  });

  let datasourceId = experiment.datasource;

  if (data.datasource) {
    datasourceId = data.datasource;
    const datasource = await getDataSourceById(context, data.datasource);
    if (!datasource) {
      res.status(403).json({
        status: 403,
        message: "Invalid datasource: " + data.datasource,
      });
      return;
    }
  }
  // Validate that specified metrics exist and belong to the organization
  const oldMetricIds = getAllMetricIdsFromExperiment(experiment);
  const newMetricIds = getAllMetricIdsFromExperiment(data).filter(
    (m) => !oldMetricIds.includes(m)
  );

  const metricMap = await getMetricMap(context);

  if (newMetricIds.length) {
    for (let i = 0; i < newMetricIds.length; i++) {
      const metric = metricMap.get(newMetricIds[i]);
      if (metric) {
        // Make sure it is tied to the same datasource as the experiment
        if (datasourceId && metric.datasource !== datasourceId) {
          res.status(400).json({
            status: 400,
            message:
              "Metrics must be tied to the same datasource as the experiment: " +
              newMetricIds[i],
          });
          return;
        }
      } else {
        // check to see if this metric is actually a metric group
        const metricGroup = await context.models.metricGroups.getById(
          newMetricIds[i]
        );
        if (metricGroup) {
          // Make sure it is tied to the same datasource as the experiment
          if (metricGroup.datasource !== datasourceId) {
            res.status(400).json({
              status: 400,
              message:
                "Metric group must be tied to the same datasource as the experiment: " +
                newMetricIds[i],
            });
            return;
          }
        } else {
          // new metric that's not recognized...
          res.status(403).json({
            status: 403,
            message: "Unknown metric: " + newMetricIds[i],
          });
          return;
        }
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
    "fallbackAttribute",
    "disableStickyBucketing",
    "hashVersion",
    "name",
    "tags",
    "description",
    "hypothesis",
    "activationMetric",
    "segment",
    "queryFilter",
    "skipPartialData",
    "attributionModel",
    "goalMetrics",
    "secondaryMetrics",
    "guardrailMetrics",
    "metricOverrides",
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
    "hasURLRedirects",
    "sequentialTestingEnabled",
    "sequentialTestingTuningParameter",
    "statsEngine",
    "type",
    "banditStage",
    "banditScheduleValue",
    "banditScheduleUnit",
    "banditBurnInValue",
    "banditBurnInUnit",
    "customFields",
    "shareLevel",
    "uid",
    "analysisSummary",
    "dismissedWarnings",
  ];
  let changes: Changeset = {};

  keys.forEach((key) => {
    if (!(key in data)) {
      return;
    }

    // Do a deep comparison for arrays, shallow for everything else
    let hasChanges = data[key] !== experiment[key];
    if (
      key === "goalMetrics" ||
      key === "secondaryMetrics" ||
      key === "guardrailMetrics" ||
      key === "metricOverrides" ||
      key === "variations" ||
      key === "customFields"
    ) {
      hasChanges =
        JSON.stringify(data[key]) !== JSON.stringify(experiment[key]);
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

  // Clean up some vars for bandits, but only if safe to do so...
  // If it's a draft, hasn't been run as a bandit before, and is/will be a MAB:
  if (
    experiment.status === "draft" &&
    experiment.banditStage === undefined &&
    ((data.type === undefined && experiment.type === "multi-armed-bandit") ||
      data.type === "multi-armed-bandit")
  ) {
    changes = resetExperimentBanditSettings({
      experiment,
      metricMap,
      changes,
      settings,
    });
  }
  // If it's already a bandit and..
  if (experiment.type === "multi-armed-bandit") {
    // ...the schedule has changed, recompute next run
    if (
      changes.banditScheduleUnit !== undefined ||
      changes.banditScheduleValue !== undefined ||
      changes.banditBurnInUnit !== undefined ||
      changes.banditBurnInValue !== undefined
    ) {
      changes.nextSnapshotAttempt = determineNextBanditSchedule({
        ...experiment,
        ...changes,
      } as ExperimentInterface);
    }
  }

  if (data.variationWeights) {
    const phases = [...experiment.phases];
    const lastIndex = phases.length - 1;
    phases[lastIndex] = {
      ...phases[lastIndex],
      variationWeights: data.variationWeights,
    };
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
    "type",
    "banditStage",
    "banditStageDateStarted",
    "banditScheduleValue",
    "banditScheduleUnit",
    "banditBurnInValue",
    "banditBurnInUnit",
  ] as (keyof ExperimentInterfaceStringDates)[]).some((key) => key in changes);
  if (needsRunExperimentsPermission) {
    const linkedFeatureIds = experiment.linkedFeatures || [];

    const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

    const envs = getAffectedEnvsForExperiment({
      experiment,
      orgEnvironments: context.org.settings?.environments || [],
      linkedFeatures,
    });
    if (envs.length > 0) {
      const projects = [experiment.project || undefined];
      if ("project" in changes) {
        projects.push(changes.project || undefined);
      }
      // check user's permission on existing experiment project and the updated project, if changed
      projects.forEach((project) => {
        if (!context.permissions.canRunExperiment({ project }, envs)) {
          context.permissions.throwPermissionError();
        }
      });
    }
  }

  const updated = await updateExperiment({
    context,
    experiment,
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
            context,
          })
        )
      );
    }

    const urlRedirects = await context.models.urlRedirects.findByExperiment(
      experiment.id
    );
    if (urlRedirects.length) {
      await Promise.all(
        urlRedirects.map((urlRedirect) =>
          context.models.urlRedirects.syncURLRedirectsWithVariations(
            urlRedirect,
            updated
          )
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

  await upsertWatch({
    userId,
    organization: org.id,
    item: experiment.id,
    type: "experiments",
  });

  res.status(200).json({
    status: 200,
    experiment: updated,
  });
}

export async function postExperimentArchive(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);

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

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });
  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  changes.archived = true;

  try {
    await updateExperiment({
      context,
      experiment,
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
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);
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

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  changes.archived = false;

  try {
    await updateExperiment({
      context,
      experiment,
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
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const { status, reason, dateEnded } = req.body;

  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);
  if (!experiment) {
    throw new Error("Experiment not found");
  }
  if (experiment.organization !== org.id) {
    throw new Error("You do not have access to this experiment");
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const { settings } = getScopedSettings({
    organization: org,
    experiment,
  });

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  // If status changed from running to stopped, update the latest phase
  const phases = [...experiment.phases];
  const lastIndex = phases.length - 1;
  if (
    experiment.status === "running" &&
    status === "stopped" &&
    phases?.length > 0 &&
    !phases[lastIndex].dateEnded
  ) {
    phases[lastIndex] = {
      ...phases[lastIndex],
      reason,
      dateEnded: dateEnded ? getValidDate(dateEnded + ":00Z") : new Date(),
    };
    changes.phases = phases;
  }
  // Starting an experiment from draft
  else if (
    experiment.status === "draft" &&
    status === "running" &&
    phases?.length > 0
  ) {
    const additionalChanges: Changeset = await getChangesToStartExperiment(
      context,
      experiment
    );
    Object.assign(changes, additionalChanges);
  }
  // If starting or drafting a stopped experiment, clear the phase end date
  // and perform any needed bandit cleanup
  else if (
    experiment.status === "stopped" &&
    (status === "running" || status === "draft") &&
    phases?.length > 0
  ) {
    const clonedPhase = { ...phases[lastIndex] };
    delete clonedPhase.dateEnded;
    phases[lastIndex] = clonedPhase;
    changes.phases = phases;

    // Bandit-specific changes
    if (experiment.type === "multi-armed-bandit") {
      // We must create a new phase. No continuing old phases allowed
      // If we had a previous phase, mark it as ended
      if (phases.length) {
        phases[phases.length - 1].dateEnded = new Date();
      }

      phases.push({
        condition: clonedPhase.condition,
        savedGroups: clonedPhase.savedGroups,
        prerequisites: clonedPhase.prerequisites,
        coverage: clonedPhase.coverage,
        dateStarted: new Date(),
        name: "Main",
        namespace: clonedPhase.namespace,
        reason: "",
        variationWeights: clonedPhase.variationWeights,
        seed: uuidv4(),
      });

      // flush the sticky existing buckets
      changes.bucketVersion = (experiment.bucketVersion ?? 0) + 1;
      changes.minBucketVersion = (experiment.bucketVersion ?? 0) + 1;

      Object.assign(
        changes,
        resetExperimentBanditSettings({
          experiment,
          changes,
          settings,
        })
      );
    }
  }

  changes.status = status;

  const updated = await updateExperiment({
    context,
    experiment,
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
  const context = getContextFromReq(req);
  const { org } = context;
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

  const experiment = await getExperimentById(context, id);
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

  if (!context.permissions.canUpdateExperiment(experiment, req.body)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  const phases = [...experiment.phases];
  // Already has phases
  if (phases.length) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      dateEnded: dateEnded ? getValidDate(dateEnded + ":00Z") : new Date(),
      coverage: !excludeFromPayload ? 1 : phases[phases.length - 1].coverage,
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
  if (experiment.type == "multi-armed-bandit") {
    // pause bandit stage
    changes.banditStage = "paused";
    changes.banditStageDateStarted = new Date();
  }

  try {
    const updated = await updateExperiment({
      context,
      experiment,
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
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, phase } = req.params;
  const phaseIndex = parseInt(phase);

  const experiment = await getExperimentById(context, id);
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

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  if (experiment.phases.length === 1) {
    res.status(400).json({
      status: 400,
      message: "Cannot delete the only phase",
    });
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  if (phaseIndex < 0 || phaseIndex >= experiment.phases?.length) {
    throw new Error("Invalid phase id");
  }

  // Remove an element from an array without mutating the original
  changes.phases = experiment.phases.filter((phase, i) => i !== phaseIndex);

  if (!changes.phases.length) {
    changes.status = "draft";
    if (experiment.type === "multi-armed-bandit") {
      changes.banditStage = "paused";
    }
  }
  const updated = await updateExperiment({
    context,
    experiment,
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
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const i = parseInt(req.params.phase);
  const phase = req.body;

  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (experiment.organization !== org.id) {
    throw new Error("You do not have access to this experiment");
  }

  const { settings } = getScopedSettings({
    organization: org,
    experiment,
  });

  if (!experiment.phases?.[i]) {
    throw new Error("Invalid phase");
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
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

  if (experiment.type === "multi-armed-bandit") {
    Object.assign(
      changes,
      resetExperimentBanditSettings({
        experiment,
        changes,
        settings,
      })
    );
  }

  const updated = await updateExperiment({
    context,
    experiment,
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

export async function postExperimentTargeting(
  req: AuthRequest<ExperimentTargetingData, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { id } = req.params;

  const {
    condition,
    savedGroups,
    prerequisites,
    coverage,
    hashAttribute,
    fallbackAttribute,
    hashVersion,
    disableStickyBucketing,
    bucketVersion,
    minBucketVersion,
    namespace,
    trackingKey,
    variationWeights,
    seed,
    newPhase,
    reseed,
  } = req.body;

  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  const { settings } = getScopedSettings({
    organization: org,
    experiment,
  });

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  const phases = [...experiment.phases];

  // Already has phases and we're updating an existing phase
  if (phases.length && !newPhase) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      condition,
      savedGroups,
      prerequisites,
      coverage,
      namespace,
      variationWeights,
      seed,
    };
  } else {
    // If we had a previous phase, mark it as ended
    if (phases.length) {
      phases[phases.length - 1].dateEnded = new Date();
    }

    phases.push({
      condition,
      savedGroups,
      prerequisites,
      coverage,
      dateStarted: new Date(),
      name: "Main",
      namespace,
      reason: "",
      variationWeights,
      seed: phases.length && reseed ? uuidv4() : seed,
    });
  }
  changes.phases = phases;

  if (experiment.type === "multi-armed-bandit") {
    Object.assign(
      changes,
      resetExperimentBanditSettings({
        experiment,
        changes,
        settings,
      })
    );
  }

  changes.hashAttribute = hashAttribute;
  changes.fallbackAttribute = fallbackAttribute;
  changes.hashVersion = hashVersion;
  changes.disableStickyBucketing = disableStickyBucketing;
  changes.bucketVersion = bucketVersion;
  changes.minBucketVersion = minBucketVersion;
  if (trackingKey) changes.trackingKey = trackingKey;

  // TODO: validation
  try {
    const updated = await updateExperiment({
      context,
      experiment,
      changes,
    });

    await req.audit({
      event: "experiment.update",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsUpdate(experiment, updated),
    });

    await upsertWatch({
      userId,
      organization: org.id,
      item: experiment.id,
      type: "experiments",
    });

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "Failed to edit experiment targeting",
    });
  }
}

export async function postExperimentPhase(
  req: AuthRequest<ExperimentPhase, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { id } = req.params;
  const { reason, dateStarted, ...data } = req.body;

  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

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
  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

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
      context,
      experiment,
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

    await upsertWatch({
      userId,
      organization: org.id,
      item: experiment.id,
      type: "experiments",
    });

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
  const { org } = getContextFromReq(req);
  const { id } = req.params;
  const watchers = await getExperimentWatchers(id, org.id);
  res.status(200).json({
    status: 200,
    userIds: watchers,
  });
}

export async function deleteExperiment(
  req: AuthRequest<ExperimentInterface, { id: string }>,
  res: Response<
    { status: 200 } | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);

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

  if (!context.permissions.canDeleteExperiment(experiment)) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  await Promise.all([
    // note: we might want to change this to change the status to
    // 'deleted' instead of actually deleting the document.
    deleteExperimentByIdForOrganization(context, experiment),
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

export async function cancelSnapshot(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const snapshot = await findSnapshotById(org.id, id);
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "No snapshot found with that id",
    });
  }

  const experiment = await getExperimentById(context, snapshot.experiment);

  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    snapshot.settings.datasourceId
  );

  const queryRunner = new ExperimentResultsQueryRunner(
    context,
    snapshot,
    integration
  );
  await queryRunner.cancelQueries();
  await deleteSnapshotById(org.id, snapshot.id);

  res.status(200).json({ status: 200 });
}

function getSnapshotType({
  experiment,
  dimension,
  phaseIndex,
}: {
  experiment: ExperimentInterface;
  dimension: string | undefined;
  phaseIndex: number;
}): SnapshotType {
  // dimension analyses are ad-hoc
  if (dimension) {
    return "exploratory";
  }

  // analyses of old phases are ad-hoc
  if (phaseIndex !== experiment.phases.length - 1) {
    return "exploratory";
  }

  return "standard";
}

export async function createExperimentSnapshot({
  context,
  experiment,
  datasource,
  dimension,
  phase,
  useCache = true,
  triggeredBy,
  type,
  reweight,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  dimension: string | undefined;
  phase: number;
  useCache?: boolean;
  triggeredBy?: SnapshotTriggeredBy;
  type?: SnapshotType;
  reweight?: boolean;
}): Promise<{
  snapshot: ExperimentSnapshotInterface;
  queryRunner: ExperimentResultsQueryRunner;
}> {
  const snapshotType =
    type ??
    getSnapshotType({
      experiment,
      dimension,
      phaseIndex: phase,
    });

  let project = null;
  if (experiment.project) {
    project = await context.models.projects.getById(experiment.project);
  }

  const { org } = context;
  const orgSettings: OrganizationSettings = org.settings as OrganizationSettings;
  const { settings } = getScopedSettings({
    organization: org,
    project: project ?? undefined,
    experiment,
  });
  const statsEngine = settings.statsEngine.value;

  const metricMap = await getMetricMap(context);
  const metricIds = getAllMetricIdsFromExperiment(experiment, false);

  const allExperimentMetrics = metricIds.map((m) => metricMap.get(m) || null);
  const denominatorMetricIds = uniq<string>(
    allExperimentMetrics
      .map((m) => m?.denominator)
      .filter((d) => d && typeof d === "string") as string[]
  );
  const denominatorMetrics = denominatorMetricIds
    .map((m) => metricMap.get(m) || null)
    .filter(isDefined) as MetricInterface[];
  const {
    settingsForSnapshotMetrics,
    regressionAdjustmentEnabled,
  } = getAllMetricSettingsForSnapshot({
    allExperimentMetrics,
    denominatorMetrics,
    orgSettings,
    experimentRegressionAdjustmentEnabled:
      experiment.regressionAdjustmentEnabled,
    experimentMetricOverrides: experiment.metricOverrides,
    datasourceType: datasource?.type,
    hasRegressionAdjustmentFeature: true,
  });

  const analysisSettings = getDefaultExperimentAnalysisSettings(
    statsEngine,
    experiment,
    org,
    regressionAdjustmentEnabled,
    dimension
  );

  const factTableMap = await getFactTableMap(context);

  const queryRunner = await createSnapshot({
    experiment,
    context,
    phaseIndex: phase,
    useCache,
    defaultAnalysisSettings: analysisSettings,
    additionalAnalysisSettings: getAdditionalExperimentAnalysisSettings(
      analysisSettings
    ),
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    reweight,
    type: snapshotType,
    triggeredBy: triggeredBy ?? "manual",
  });
  const snapshot = queryRunner.model;

  return { snapshot, queryRunner };
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
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const { phase, dimension } = req.body;

  const experiment = await getExperimentById(context, id);
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

    let project = null;
    if (experiment.project) {
      project = await context.models.projects.getById(experiment.project);
    }
    const { settings } = getScopedSettings({
      organization: org,
      project: project ?? undefined,
      experiment,
    });
    const statsEngine = settings.statsEngine.value;
    const metricDefaults = settings.metricDefaults.value;

    const analysisSettings = getDefaultExperimentAnalysisSettings(
      statsEngine,
      experiment,
      org,
      false,
      dimension
    );

    const metricMap = await getMetricMap(context);

    try {
      const snapshot = await createManualSnapshot({
        experiment,
        phaseIndex: phase,
        users,
        metrics,
        orgPriorSettings: metricDefaults.priorSettings,
        analysisSettings,
        metricMap,
        context,
      });
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

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource for this experiment");
  }

  const useCache = !req.query["force"];

  // This is doing an expensive analytics SQL query, so may take a long time
  // Set timeout to 30 minutes
  req.setTimeout(SNAPSHOT_TIMEOUT);

  try {
    const { snapshot } = await createExperimentSnapshot({
      context,
      experiment,
      datasource,
      dimension,
      phase,
      useCache,
      type:
        experiment.type === "multi-armed-bandit" ? "exploratory" : undefined,
    });

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
export async function postSnapshotAnalysis(
  req: AuthRequest<
    {
      analysisSettings: ExperimentSnapshotAnalysisSettings;
      phaseIndex?: number;
    },
    { id: string }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const { id } = req.params;
  const snapshot = await findSnapshotById(org.id, id);
  if (!snapshot) {
    res.status(404).json({
      status: 404,
      message: "Snapshot not found",
    });
    return;
  }

  const { analysisSettings, phaseIndex } = req.body;

  const experiment = await getExperimentById(context, snapshot.experiment);
  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  if (snapshot.settings.coverage === undefined) {
    const latestPhase = experiment.phases.length - 1;
    snapshot.settings.coverage =
      experiment.phases[phaseIndex ?? latestPhase].coverage;
    // JIT migrate snapshots to have
    await updateSnapshot({
      organization: org.id,
      id,
      updates: { settings: snapshot.settings },
      context,
    });
  }

  const metricMap = await getMetricMap(context);

  try {
    await createSnapshotAnalysis({
      experiment: experiment,
      organization: org,
      analysisSettings: analysisSettings,
      metricMap: metricMap,
      snapshot: snapshot,
    });
    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    req.log.error(e, "Failed to create experiment snapshot analysis");
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function postBanditSnapshot(
  req: AuthRequest<
    {
      reweight?: boolean;
    },
    { id: string }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { reweight } = req.body;
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);
  if (!experiment) {
    res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
    return;
  }

  const phase = experiment.phases.length - 1;
  if (!experiment.phases[phase]) {
    res.status(404).json({
      status: 404,
      message: "Phase not found",
    });
    return;
  }

  if (!experiment.datasource) {
    throw new Error("Could not find datasource for this experiment");
  }

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    throw new Error("Could not find datasource for this experiment");
  }

  // This is doing an expensive analytics SQL query, so may take a long time
  // Set timeout to 30 minutes
  req.setTimeout(30 * 60 * 1000);
  let snapshot: ExperimentSnapshotInterface | undefined = undefined;

  try {
    const { queryRunner } = await createExperimentSnapshot({
      context,
      experiment,
      datasource,
      dimension: "",
      phase,
      useCache: false,
      type: "standard",
      reweight,
    });

    await queryRunner.waitForResults();
    snapshot = queryRunner.model;

    if (!snapshot?.banditResult) {
      return res.status(400).json({
        status: 400,
        message: "Unable to update bandit.",
        snapshot,
      });
    }

    const changes = updateExperimentBanditSettings({
      experiment,
      snapshot,
      reweight,
    });

    await updateExperiment({
      context,
      experiment,
      changes,
    });

    await req.audit({
      event: "experiment.refresh",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsCreate({
        phase,
        dimension: "",
        useCache: false,
        manual: false,
      }),
    });
    return res.status(200).json({
      status: 200,
      snapshot,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e?.message || e,
      snapshot,
    });
  }
}

function addCoverageToSnapshotIfMissing(
  snapshot: ExperimentSnapshotInterface,
  experiment: ExperimentInterface,
  phase?: number
): ExperimentSnapshotInterface {
  if (snapshot.settings.coverage === undefined) {
    const latestPhase = experiment.phases.length - 1;
    snapshot.settings.coverage =
      experiment.phases[phase ?? latestPhase]?.coverage ?? 1;
  }
  return snapshot;
}

export async function postSnapshotsWithScaledImpactAnalysis(
  req: AuthRequest<{
    experiments: string[];
  }>,
  res: Response<{ status: 200 } | PrivateApiErrorResponse>
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { experiments } = req.body;
  if (!experiments.length) {
    res.status(200).json({
      status: 200,
    });
    return;
  }
  const metricMap = await getMetricMap(context);
  const experimentObjs = await getExperimentsByIds(context, experiments);

  // get latest snapshot for latest phase without dimensions but with results
  const snapshots = await _getSnapshots(context, experimentObjs);

  // Add snapshots missing scaled analysis to list to fetch
  const snapshotAnalysesToCreate: SnapshotAnalysisParams[] = [];
  snapshots.forEach((s) => {
    const defaultAnalysis = getSnapshotAnalysis(s);
    if (!defaultAnalysis) return;

    const scaledImpactAnalysisSettings: ExperimentSnapshotAnalysisSettings = {
      ...defaultAnalysis.settings,
      differenceType: "scaled",
    };
    if (getSnapshotAnalysis(s, scaledImpactAnalysisSettings)) return;

    const experiment = experimentObjs.find((e) => e.id === s.experiment);
    if (!experiment) return;

    addCoverageToSnapshotIfMissing(s, experiment);

    snapshotAnalysesToCreate.push({
      experiment: experiment,
      organization: org,
      analysisSettings: scaledImpactAnalysisSettings,
      metricMap: metricMap,
      snapshot: s,
    });
  });

  if (snapshotAnalysesToCreate.length > 0) {
    await createSnapshotAnalyses(snapshotAnalysesToCreate, context).catch(
      (e) => {
        req.log.error(e);
      }
    );
  }
  res.status(200).json({
    status: 200,
  });
  return;
}

export async function deleteScreenshot(
  req: AuthRequest<{ url: string }, { id: string; variation: number }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, variation } = req.params;
  const { url } = req.body;
  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

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

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

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
    context,
    experiment,
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
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { id, variation } = req.params;
  const { url, description } = req.body;
  const changes: Changeset = {};

  const experiment = await getExperimentById(context, id);

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

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

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
    context,
    experiment,
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

  await upsertWatch({
    userId,
    organization: org.id,
    item: experiment.id,
    type: "experiments",
  });

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
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const pastExperiments = await getPastExperimentsById(org.id, id);
  if (!pastExperiments) {
    throw new Error("Could not cancel query");
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    pastExperiments.datasource
  );

  const queryRunner = new PastExperimentsQueryRunner(
    context,
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
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const pastExperiments = await getPastExperimentsById(org.id, id);

  if (!pastExperiments) {
    throw new Error("Invalid import id");
  }

  const experiments = await getPastExperimentsByDatasource(
    context,
    pastExperiments.datasource
  );

  const experimentMap = new Map<string, string>();
  (experiments || []).forEach((e) => {
    experimentMap.set(e.trackingKey, e.id);
    experimentMap.set(e.trackingKey + "::" + e.exposureQueryId, e.id);
  });

  const trackingKeyMap: Record<string, string> = {};
  (pastExperiments.experiments || []).forEach((e) => {
    const keys = [e.trackingKey, e.trackingKey + "::" + e.exposureQueryId];
    keys.forEach((key) => {
      const id = experimentMap.get(key);
      if (id) {
        trackingKeyMap[key] = id;
      }
    });
  });

  res.status(200).json({
    status: 200,
    experiments: pastExperiments,
    existing: trackingKeyMap,
    lookbackDays: IMPORT_LIMIT_DAYS,
  });
}

//experiments/import, sent here right after "add experiment"
export async function postPastExperiments(
  req: AuthRequest<{ datasource: string; force: boolean; refresh?: boolean }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { datasource, force, refresh } = req.body;

  const integration = await getIntegrationFromDatasourceId(
    context,
    datasource,
    true
  );

  let pastExperiments = await getPastExperimentsModelByDatasource(
    org.id,
    datasource
  );

  const start = new Date();
  start.setDate(start.getDate() - IMPORT_LIMIT_DAYS);

  if (!pastExperiments) {
    pastExperiments = await createPastExperiments({
      organization: org.id,
      datasource,
      experiments: [],
      start,
      queries: [],
    });
  }

  let needsRun = false;
  if (force) {
    needsRun = true;
    pastExperiments = await updatePastExperiments(pastExperiments, {
      config: {
        start:
          !refresh && pastExperiments.config
            ? pastExperiments.config.start
            : start,
        end: new Date(),
      },
    });
  }

  if (needsRun) {
    const queryRunner = new PastExperimentsQueryRunner(
      context,
      pastExperiments,
      integration
    );
    pastExperiments = await queryRunner.startAnalysis({
      from: start,
      forceRefresh: !!refresh,
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
  const context = getContextFromReq(req);
  if (!req.body.urlPatterns) {
    throw new Error("urlPatterns needs to be defined");
  }

  if (!req.body.editorUrl) {
    throw new Error("editorUrl needs to be defined");
  }

  const experiment = await getExperimentById(context, req.params.id);

  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  const visualChangeset = await createVisualChangeset({
    experiment,
    urlPatterns: req.body.urlPatterns,
    editorUrl: req.body.editorUrl,
    context,
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
  const context = getContextFromReq(req);
  const { org } = context;

  const visualChangeset = await findVisualChangesetById(req.params.id, org.id);
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const experiment = await getExperimentById(
    context,
    visualChangeset.experiment
  );
  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const updates: Partial<VisualChangesetInterface> = {
    editorUrl: req.body.editorUrl,
    urlPatterns: req.body.urlPatterns,
    visualChanges: req.body.visualChanges,
  };

  const linkedFeatureIds = experiment.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = experiment
    ? getAffectedEnvsForExperiment({
        experiment,
        linkedFeatures,
        orgEnvironments: context.org.settings?.environments || [],
      })
    : [];
  if (!context.permissions.canRunExperiment(experiment, envs)) {
    context.permissions.throwPermissionError();
  }

  const ret = await updateVisualChangeset({
    visualChangeset,
    experiment,
    context,
    updates,
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
  const context = getContextFromReq(req);
  const { org } = context;

  const visualChangeset = await findVisualChangesetById(req.params.id, org.id);
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const experiment = await getExperimentById(
    context,
    visualChangeset.experiment
  );

  const linkedFeatureIds = experiment?.linkedFeatures || [];

  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);

  const envs = experiment
    ? getAffectedEnvsForExperiment({
        experiment,
        linkedFeatures,
        orgEnvironments: context.org.settings?.environments || [],
      })
    : [];
  if (!context.permissions.canRunExperiment(experiment || {}, envs)) {
    context.permissions.throwPermissionError();
  }

  await deleteVisualChangesetById({
    visualChangeset,
    experiment,
    context,
  });

  res.status(200).json({
    status: 200,
  });
}

export async function findOrCreateVisualEditorToken(
  req: AuthRequest,
  res: Response
) {
  const { org } = getContextFromReq(req);

  if (!req.userId) throw new Error("No user found");

  let visualEditorKey = await getVisualEditorApiKey(org.id, req.userId);

  // if not exist, create one
  if (!visualEditorKey) {
    visualEditorKey = await createUserVisualEditorApiKey({
      userId: req.userId,
      organizationId: org.id,
      description: `Created automatically for the Visual Editor`,
    });
  }

  res.status(200).json({
    key: visualEditorKey.key,
  });
}

export async function refreshTimeSeries(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const experiment = await getExperimentById(context, id);
  if (!experiment) {
    throw new Error("Experiment not found");
  }

  await context.models.metricTimeSeries.deleteMetricTimeSeriesBySource(
    "experiment",
    id
  );

  const allSnapshots = await getAllSnapshotsForTimeSeries({
    experiment: id,
    phase: experiment.phases.length - 1,
  });

  // Very naive approach to validate the logic of incremental updates
  for (const snapshot of allSnapshots) {
    await updateExperimentTimeSeries({
      context,
      experiment,
      experimentSnapshot: snapshot,
    });
  }

  res.status(200).json({
    success: true,
  });
}

export async function getTimeSeries(
  req: AuthRequest<null, { id: string }, { metricIds: string[] }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { metricIds } = req.query;
  if (!metricIds) {
    throw new Error("metricIds is required");
  }

  const timeSeries = await context.models.metricTimeSeries.getMetricTimeSeriesBySource(
    "experiment",
    id,
    metricIds
  );

  res.status(200).json({
    timeSeries,
  });
}
