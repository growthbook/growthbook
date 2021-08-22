import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import {
  SegmentComparisonModel,
  SegmentComparisonDocument,
} from "../models/SegmentComparisonModel";
import { userHasAccess } from "../services/organizations";
import uniqid from "uniqid";
import { getSourceIntegrationObject } from "../services/datasource";
import { ABTestStats, getValueCR, abtest } from "../services/stats";
import { getMetricsByDatasource } from "../models/MetricModel";
import {
  QueryMap,
  getUsers,
  getStatusEndpoint,
  getMetricValue,
  startRun,
  cancelRun,
} from "../services/queries";
import { QueryDocument } from "../models/QueryModel";
import {
  MetricValueResult,
  UsersResult,
  UsersQueryParams,
} from "../types/Integration";
import { SegmentModel, SegmentDocument } from "../models/SegmentModel";
import { SegmentInterface } from "../../types/segment";
import {
  SegmentComparisonInterface,
  SegmentComparisonResults,
} from "../../types/segment-comparison";
import { MetricStats } from "../../types/metric";
import { getDataSourceById } from "../models/DataSourceModel";

export async function getAllSegments(req: AuthRequest, res: Response) {
  const segments = await SegmentModel.find({
    organization: req.organization.id,
  });
  res.status(200).json({
    status: 200,
    segments,
  });
}
export async function postSegments(
  req: AuthRequest<Partial<SegmentInterface>>,
  res: Response
) {
  const { datasource, name, sql } = req.body;

  const datasourceDoc = await getDataSourceById(
    datasource,
    req.organization.id
  );
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  const doc = await SegmentModel.create({
    datasource,
    name,
    sql,
    id: uniqid("seg_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: req.organization.id,
  });

  res.status(200).json({
    status: 200,
    segment: doc,
  });
}
export async function putSegment(
  req: AuthRequest<Partial<SegmentInterface>>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const segment = await SegmentModel.findOne({
    id,
  });

  if (!segment) {
    throw new Error("Could not find segment");
  }
  if (segment.organization !== req.organization.id) {
    throw new Error("You don't have access to that segment");
  }

  const { datasource, name, sql } = req.body;

  const datasourceDoc = await getDataSourceById(
    datasource,
    req.organization.id
  );
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  segment.set("datasource", datasource);
  segment.set("name", name);
  segment.set("sql", sql);
  segment.set("dateUpdated", new Date());

  await segment.save();

  res.status(200).json({
    status: 200,
    segment,
  });
}

export async function getAllSegmentComparisons(
  req: AuthRequest,
  res: Response
) {
  // List of comparisons without results (results are very large, so want to reduce bandwidth)
  const comparisons = await SegmentComparisonModel.find(
    {
      organization: req.organization.id,
    },
    {
      results: false,
      queries: false,
    }
  );

  res.status(200).json({
    status: 200,
    comparisons: comparisons || [],
  });
}
export async function getSegmentComparison(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;

  const comparison = await SegmentComparisonModel.findOne({
    id,
  });

  if (!comparison) {
    return res.status(404).json({
      status: 404,
      message: "Could not find segment comparison",
    });
  }

  if (!userHasAccess(req, comparison.organization)) {
    return res.status(403).json({
      status: 403,
      message: "You do not have access to this segment comparison",
    });
  }

  res.status(200).json({
    status: 200,
    comparison,
  });
}

async function processResults(
  doc: SegmentComparisonDocument,
  data: QueryMap
): Promise<SegmentComparisonResults> {
  const segment1Users: UsersResult = data.get("users_segment1")
    ?.result as UsersResult;
  const segment2Users: UsersResult = data.get("users_segment2")
    ?.result as UsersResult;

  const results: SegmentComparisonResults = {
    users: {
      segment1: segment1Users?.users || 0,
      segment2: segment2Users?.users || 0,
    },
    metrics: {},
  };

  // Stats for each metric
  const metrics = await getMetricsByDatasource(
    doc.datasource,
    doc.organization
  );
  const selectedMetrics = metrics.filter((m) => doc.metrics.includes(m.id));
  await Promise.all(
    selectedMetrics.map(async (m) => {
      const segment1Result: MetricValueResult = data.get(`${m.id}_segment1`)
        ?.result;
      const segment2Result: MetricValueResult = data.get(`${m.id}_segment2`)
        ?.result;

      // TODO: support calculating total from dates

      const v1Stats: MetricStats = {
        count: segment1Result?.count || 0,
        mean: segment1Result?.mean || 0,
        stddev: segment1Result?.stddev || 0,
      };
      const v2Stats: MetricStats = {
        count: segment2Result?.count || 0,
        mean: segment2Result?.mean || 0,
        stddev: segment2Result?.stddev || 0,
      };

      const v1 = v1Stats.mean * v1Stats.count;
      const v2 = v2Stats.mean * v2Stats.count;

      let stats: ABTestStats;
      if (!v1 || !v2 || !results.users.segment1 || !results.users.segment2) {
        stats = {
          buckets: [],
          chanceToWin: 0,
          ci: [0, 0],
          expected: 0,
        };
      } else {
        stats = await abtest(
          m,
          results.users.segment1,
          v1Stats,
          results.users.segment2,
          v2Stats
        );
      }

      results.metrics[m.id] = {
        segment1: getValueCR(m, v1, v1Stats.count, results.users.segment1),
        segment2: {
          ...getValueCR(m, v2, v2Stats.count, results.users.segment2),
          ...stats,
        },
      };
    })
  );

  return results;
}

export async function getSegmentComparisonStatus(
  req: AuthRequest,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const comparison = await SegmentComparisonModel.findOne({ id });
  const result = await getStatusEndpoint(
    comparison,
    req.organization.id,
    (data) => processResults(comparison, data),
    async (updates, results) => {
      await SegmentComparisonModel.updateOne(
        { id },
        {
          $set: {
            ...updates,
            results,
          },
        }
      );
    }
  );
  return res.status(200).json(result);
}

export async function cancelSegmentComparison(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;
  const comparison = await SegmentComparisonModel.findOne({
    id,
    organization: req.organization.id,
  });
  res.status(200).json(
    await cancelRun(comparison, req.organization.id, async () => {
      comparison.set("queries", []);
      comparison.set("runStarted", null);
      await comparison.save();
    })
  );
}

function parseApiDate(date: string | Date | null | undefined): Date {
  return new Date(date);
}

function needsNewResults(data: Partial<SegmentComparisonInterface>) {
  // Missing datasource or segment, return false
  if (!data.datasource) return false;
  if (!data.segment1?.segment) return false;
  if (!data.segment2?.segment) return false;

  // Missing segment dates, return false
  if (!data.segment1?.from) return false;
  if (!data.segment1?.to) return false;
  if (!data.segment2?.sameDateRange && !data.segment2?.from) return false;
  if (!data.segment2?.sameDateRange && !data.segment2?.to) return false;

  // No metrics, return false
  if (!data.metrics || !data.metrics.length) return false;

  // Otherwise, run the analysis
  return true;
}

export async function putSegmentComparison(
  req: AuthRequest<Partial<SegmentComparisonInterface>>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const data = req.body;

  // Turn dates into actual Date objects
  data.segment1.from = parseApiDate(data.segment1?.from);
  data.segment1.to = parseApiDate(data.segment1?.to);
  data.segment2.from = parseApiDate(data.segment2?.from);
  data.segment2.to = parseApiDate(data.segment2?.to);

  const comparison = await SegmentComparisonModel.findOne({
    id,
  });

  if (comparison.organization !== req.organization.id) {
    return res.status(403).json({
      status: 403,
      message: "You do not have access to this segment comparison",
    });
  }

  // Only recalculate results if something meaningful changed (e.g. the sql queries)
  // Avoids recalculating on things like title changes
  const recalculate = needsNewResults(data);

  comparison.set("title", data.title);
  comparison.set("datasource", data.datasource);
  comparison.set("metrics", data.metrics);
  comparison.set("segment1", data.segment1);
  comparison.set("segment2", data.segment2);
  comparison.set("dateUpdated", new Date());

  // Calculate results and update
  if (recalculate) {
    const datasource = await getDataSourceById(
      comparison.datasource,
      req.organization.id
    );
    if (!datasource) {
      return res.status(403).json({
        status: 403,
        message: "You do not have access to that datasource",
      });
    }
    const integration = getSourceIntegrationObject(datasource);

    const segments = await SegmentModel.find({
      organization: req.organization.id,
      datasource: datasource.id,
      id: {
        $in: [data.segment1.segment, data.segment2.segment],
      },
    });
    let segment1: SegmentDocument, segment2: SegmentDocument;
    segments.forEach((segment) => {
      if (segment.id === data.segment1.segment) {
        segment1 = segment;
      }
      if (segment.id === data.segment2.segment) {
        segment2 = segment;
      }
    });
    if (!segment1 || !segment2) {
      throw new Error("Invalid segment selected");
    }

    const promises: Record<string, Promise<QueryDocument>> = {};

    const segment1Params: UsersQueryParams = {
      from: data.segment1.from,
      name: segment1.name,
      segmentQuery: segment1.sql,
      segmentName: segment1.name,
      userIdType: "user",
      to: data.segment1.to,
    };
    const segment2Params: UsersQueryParams = {
      from: data.segment2.sameDateRange
        ? data.segment1.from
        : data.segment2.from,
      name: segment2.name,
      segmentQuery: segment2.sql,
      segmentName: segment2.name,
      userIdType: "user",
      to: data.segment2.sameDateRange ? data.segment1.to : data.segment2.to,
    };

    // User counts for both segments
    promises["users_segment1"] = getUsers(integration, segment1Params);
    promises["users_segment2"] = getUsers(integration, segment2Params);

    // Metric values
    const metrics = await getMetricsByDatasource(
      comparison.datasource,
      comparison.organization
    );
    const selectedMetrics = metrics.filter((m) =>
      comparison.metrics.includes(m.id)
    );
    selectedMetrics.forEach((metric) => {
      promises[`${metric.id}_segment1`] = getMetricValue(integration, {
        metric,
        ...segment1Params,
      });
      promises[`${metric.id}_segment2`] = getMetricValue(integration, {
        metric,
        ...segment2Params,
      });
    });

    comparison.set("runStarted", new Date());
    const { queries, result } = await startRun(promises, (data) =>
      processResults(comparison, data)
    );
    comparison.set("queries", queries);
    if (result) {
      comparison.set("results", result);
    }
  }

  await comparison.save();
  return res.status(200).json({
    status: 200,
    comparison: comparison,
  });
}

export async function postSegmentComparisons(req: AuthRequest, res: Response) {
  const doc: SegmentComparisonInterface = {
    id: uniqid("sc_"),
    title: "New Comparison",
    segment1: {
      segment: "",
      from: new Date(),
      to: new Date(),
    },
    segment2: {
      segment: "",
      from: new Date(),
      to: new Date(),
      sameDateRange: true,
    },
    datasource: null,
    metrics: [],
    queries: [],
    results: null,
    organization: req.organization.id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    runStarted: null,
  };

  const comparison = await SegmentComparisonModel.create(doc);

  res.status(200).json({
    status: 200,
    id: comparison.id,
  });
}
