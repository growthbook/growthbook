import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  createMetric,
  removeMetricFromExperiments,
  getMetricAnalysis,
  refreshMetric,
  getExperimentsByMetric,
} from "../services/experiments";
import { MetricAnalysis, MetricInterface } from "../../types/metric";
import { ExperimentModel } from "../models/ExperimentModel";
import { addTagsDiff } from "../models/TagModel";
import { getOrgFromReq } from "../services/organizations";
import { getStatusEndpoint, cancelRun } from "../services/queries";
import {
  deleteMetricById,
  getMetricsByOrganization,
  getMetricById,
  updateMetric,
} from "../models/MetricModel";
import { IdeaInterface } from "../../types/idea";

import { getDataSourceById } from "../models/DataSourceModel";
import { getIdeasByQuery } from "../services/ideas";
import { ImpactEstimateModel } from "../models/ImpactEstimateModel";
import {
  auditDetailsCreate,
  auditDetailsUpdate,
  auditDetailsDelete,
} from "../services/audit";

export async function deleteMetric(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("createAnalyses", "");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const metric = await getMetricById(id, org.id);
  req.checkPermissions(
    "createMetrics",
    metric?.projects?.length ? metric.projects : ""
  );

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
  await removeMetricFromExperiments(metric.id, org);

  // now remove the metric itself:
  await deleteMetricById(metric.id, org.id);

  await req.audit({
    event: "metric.delete",
    entity: {
      object: "metric",
      id: metric.id,
    },
    details: auditDetailsDelete(metric),
  });

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
  req.checkPermissions("runQueries", "");

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
  req.checkPermissions("runQueries", "");

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
  const { org, userName } = getOrgFromReq(req);

  const {
    name,
    description,
    type,
    table,
    column,
    inverse,
    ignoreNulls,
    cap,
    denominator,
    conversionWindowHours,
    conversionDelayHours,
    sql,
    aggregation,
    queryFormat,
    segment,
    tags,
    projects,
    winRisk,
    loseRisk,
    maxPercentChange,
    minPercentChange,
    minSampleSize,
    conditions,
    datasource,
    timestampColumn,
    userIdType,
    userIdColumns,
    userIdColumn,
    userIdTypes,
    anonymousIdColumn,
  } = req.body;

  req.checkPermissions("createMetrics", projects?.length ? projects : "");

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
    owner: userName,
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
    denominator,
    conversionWindowHours,
    conversionDelayHours,
    userIdType,
    userIdTypes,
    sql,
    aggregation,
    queryFormat,
    status: "active",
    userIdColumns,
    userIdColumn,
    anonymousIdColumn,
    timestampColumn,
    conditions,
    tags,
    projects,
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
    details: auditDetailsCreate(metric),
  });
}

export async function putMetric(
  req: AuthRequest<Partial<MetricInterface>, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const metric = await getMetricById(id, org.id);
  if (!metric) {
    throw new Error("Could not find metric");
  }
  req.checkPermissions(
    "createMetrics",
    metric?.projects?.length ? metric.projects : ""
  );

  const updates: Partial<MetricInterface> = {};

  const fields: (keyof MetricInterface)[] = [
    "name",
    "description",
    "owner",
    "segment",
    "type",
    "inverse",
    "ignoreNulls",
    "cap",
    "denominator",
    "conversionWindowHours",
    "conversionDelayHours",
    "sql",
    "aggregation",
    "queryFormat",
    "status",
    "tags",
    "projects",
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
    "userIdColumns",
    "userIdTypes",
    "timestampColumn",
  ];
  fields.forEach((k) => {
    if (k in req.body) {
      // eslint-disable-next-line
      (updates as any)[k] = req.body[k];
    }
  });

  if (updates?.projects?.length) {
    req.checkPermissions("createMetrics", updates.projects);
  }

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
    details: auditDetailsUpdate(metric, {
      ...metric,
      ...updates,
    }),
  });
}
