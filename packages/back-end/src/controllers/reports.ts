import { Request, Response } from "express";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { getValidDate } from "shared/dates";
import { getSnapshotAnalysis } from "shared/util";
import { pick, omit } from "lodash";
import uniqid from "uniqid";
import uniq from "lodash/uniq";
import { expandMetricGroups } from "shared/experiments";
import {
  ExperimentReportInterface,
  ReportInterface,
  SSRExperimentReportData,
} from "back-end/types/report";
import {
  getExperimentById,
  getExperimentsByIds,
} from "back-end/src/models/ExperimentModel";
import {
  createExperimentSnapshotModel,
  findSnapshotById,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMap, getMetricsByIds } from "back-end/src/models/MetricModel";
import {
  createReport,
  deleteReportById,
  getReportById,
  getReportByTinyid,
  getReportsByExperimentId,
  getReportsByOrg,
  updateReport,
} from "back-end/src/models/ReportModel";
import { ReportQueryRunner } from "back-end/src/queryRunners/ReportQueryRunner";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { generateReportNotebook } from "back-end/src/services/notebook";
import {
  getContextForAgendaJobByOrgId,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getFactTableMap,
  getFactTablesByIds,
} from "back-end/src/models/FactTableModel";
import {
  ExperimentAnalysisSettings,
  experimentAnalysisSettings,
} from "back-end/src/validators/experiments";
import { FactMetricInterface } from "back-end/types/fact-table";
import { MetricInterface } from "back-end/types/metric";
import {OrganizationSettings} from "back-end/types/organization";

export async function postReportFromSnapshot(
  req: AuthRequest<null, { snapshot: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const snapshot = await findSnapshotById(org.id, req.params.snapshot);
  if (!snapshot) {
    throw new Error("Invalid snapshot id");
  }
  // Create a new report-specific snapshot
  snapshot.id = uniqid("snp_");
  snapshot.type = "report";
  await createExperimentSnapshotModel({ data: snapshot, context });

  // todo: hash dependencies so we can see if settings/inputs are stale

  const experiment = await getExperimentById(context, snapshot.experiment);

  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  if (!context.permissions.canCreateReport(experiment)) {
    context.permissions.throwPermissionError();
  }

  const phase = experiment.phases?.[snapshot.phase];
  if (!phase) {
    throw new Error("Unknown experiment phase");
  }

  const analysis = getSnapshotAnalysis(snapshot);
  if (!analysis) {
    throw new Error("Missing analysis settings");
  }

  const doc = await createReport(org.id, {
    experimentId: experiment.id,
    userId: req.userId,
    title: `New Report - ${experiment.name}`,
    description: ``,
    type: "experiment-snapshot",
    snapshot: snapshot.id,
    experimentMetadata: {
      type: experiment.type || "standard",
      phases: experiment.phases.map((phase) =>
        pick(phase, [
          "dateStarted",
          "dateEnded",
          "name",
          "variationWeights",
          "banditEvents",
        ])
      ),
      variations: experiment.variations.map((variation) =>
        omit(variation, ["description", "screenshots"])
      ),
    },
    experimentAnalysisSettings: pick(
      experiment,
      Object.keys(experimentAnalysisSettings.shape)
    ) as ExperimentAnalysisSettings,
  });

  await req.audit({
    event: "experiment.analysis",
    entity: {
      object: "experiment",
      id: snapshot.experiment,
    },
    details: JSON.stringify({
      report: doc.id,
    }),
  });

  res.status(200).json({
    status: 200,
    report: doc,
  });
}

export async function getReports(
  req: AuthRequest<
    unknown,
    unknown,
    {
      project?: string;
    }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const reports = await getReportsByOrg(context, project);

  // get the experiments for these reports, mostly needed for names.
  const experimentsIds: string[] = [];
  if (reports.length) {
    reports.forEach((r) => {
      if (r.experimentId) {
        experimentsIds.push(r.experimentId);
      }
    });
  }

  const experiments = experimentsIds.length
    ? await getExperimentsByIds(context, experimentsIds)
    : [];

  res.status(200).json({
    status: 200,
    reports,
    experiments,
  });
}

export async function getReportsOnExperiment(
  req: AuthRequest<unknown, { id: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { id } = req.params;

  const reports = await getReportsByExperimentId(org.id, id);

  res.status(200).json({
    status: 200,
    reports,
  });
}

export async function getReport(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);

  const report = await getReportById(org.id, req.params.id);

  if (!report) {
    throw new Error("Unknown report id");
  }

  res.status(200).json({
    status: 200,
    report,
  });
}

export async function getReportPublic(
  req: Request<{ tinyid: string }>,
  res: Response
) {
  const { tinyid } = req.params;
  const report = await getReportByTinyid(tinyid);
  if (!report) {
    throw new Error("Unknown report id");
  }
  const context = await getContextForAgendaJobByOrgId(report.organization);

  // todo: share permissions

  const snapshot =
    report.type === "experiment-snapshot"
      ? await findSnapshotById(report.organization, report.snapshot)
      : undefined;

  const metricGroups = await context.models.metricGroups.getAll();
  const experimentMetricIds = expandMetricGroups(
    uniq([
      ...(snapshot?.settings?.goalMetrics ?? []),
      ...(snapshot?.settings?.secondaryMetrics ?? []),
      ...(snapshot?.settings?.guardrailMetrics ?? []),
    ]),
    metricGroups
  );

  const metricIds = uniq([
    ...experimentMetricIds,
    ...(snapshot?.settings?.activationMetric
      ? [snapshot?.settings?.activationMetric]
      : []),
  ]);

  const metrics: MetricInterface[] = await getMetricsByIds(
    context,
    metricIds.filter((m) => m.startsWith("met_"))
  );
  const factMetrics: FactMetricInterface[] = await context.models.factMetrics.getByIds(
    metricIds.filter((m) => m.startsWith("fact__"))
  );

  const denominatorMetricIds = uniq(
    metrics
      .filter((m) => !!m.denominator)
      .map((m) => m.denominator)
      .filter((id) => id && !metricIds.includes(id)) as string[]
  );
  const denominatorMetrics = await getMetricsByIds(
    context,
    denominatorMetricIds
  );

  const metricMap = [...metrics, ...factMetrics, ...denominatorMetrics].reduce(
    (map, metric) => Object.assign(map, { [metric.id]: metric }),
    {}
  );

  let factTableIds: string[] = [];
  factMetrics.forEach((m) => {
    if (m?.numerator?.factTableId) factTableIds.push(m.numerator.factTableId);
    if (m?.denominator?.factTableId)
      factTableIds.push(m.denominator.factTableId);
  });
  factTableIds = uniq(factTableIds);
  const factTables = await getFactTablesByIds(context, factTableIds);
  const factTableMap = factTables.reduce(
    (map, factTable) => Object.assign(map, { [factTable.id]: factTable }),
    {}
  );

  const settingsKeys = [
    "confidenceLevel",
    "metricDefaults",
    "multipleExposureMinPercent",
    "statsEngine",
    "pValueThreshold",
    "pValueCorrection",
    "regressionAdjustmentEnabled",
    "regressionAdjustmentDays",
    "srmThreshold",
    "attributionModel",
    "sequentialTestingEnabled",
    "sequentialTestingTuningParameter",
    "displayCurrency",
  ];
  const orgSettings: OrganizationSettings = pick(context.org.settings, settingsKeys);
  // todo: consider including experiment's project settings in future? likely not...

  const ssrData: SSRExperimentReportData = {
    metrics: metricMap,
    metricGroups: metricGroups,
    factTables: factTableMap,
    settings: orgSettings,
  };

  // todo - metrics:
  // 3. scrub defs

  // todo - MetricValueColumn, etc (ResultsTable, ResultsTableTooltip):
  // 1. displayCurrency = useCurrency();
  // 2. { getFactTableById, getMetricById } = useDefinitions();
  // 3. ResultsTableTooltip: useCurrency, usePValueThreshold, getFactTableById

  // todo - PercentGraph:
  // 1. import useConfidenceLevels from "@/hooks/useConfidenceLevels";
  // 2. import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
  // 3. import usePValueThreshold from "@/hooks/usePValueThreshold";

  // todo - AlignedGraph:
  // 1. metricDisplayCurrency = useCurrency();
  // 2. { getFactTableById } = useDefinitions();

  // todo - ChangeColumn:
  // 1. displayCurrency = useCurrency();
  // 2. { getFactTableById } = useDefinitions();

  // todo - definitions:
  // 1. { metricDefaults, getMinSampleSizeForMetric } = useOrganizationMetricDefaults();
  // 2. { ciUpper, ciLower } = useConfidenceLevels();
  // 3. pValueThreshold = usePValueThreshold();
  // 4. displayCurrency = useCurrency(); (user context)
  // 5. getMaxPercentageChangeForMetric, getMinPercentageChangeForMetric, getMinSampleSizeForMetric

  res.status(200).json({
    status: 200,
    report,
    snapshot,
    ssrData,
  });
}

export async function deleteReport(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const report = await getReportById(org.id, req.params.id);

  if (!report) {
    throw new Error("Could not find report");
  }

  // Only allow admins to delete other people's reports
  if (report.userId !== req.userId) {
    if (!context.permissions.canSuperDeleteReport()) {
      context.permissions.throwPermissionError();
    }
  }

  const connectedExperiment = await getExperimentById(
    context,
    report.experimentId || ""
  );

  if (!context.permissions.canDeleteReport(connectedExperiment || {})) {
    context.permissions.throwPermissionError();
  }

  await deleteReportById(org.id, req.params.id);

  res.status(200).json({
    status: 200,
  });
}

export async function refreshReport(
  req: AuthRequest<null, { id: string }, { force?: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const report = await getReportById(org.id, req.params.id);

  if (!report) {
    throw new Error("Unknown report id");
  }
  if (report.type !== "experiment") {
    throw new Error("Invalid report type");
  }

  const useCache = !req.query["force"];

  const statsEngine = report.args?.statsEngine || DEFAULT_STATS_ENGINE;

  report.args.statsEngine = statsEngine;
  report.args.regressionAdjustmentEnabled = !!report.args
    ?.regressionAdjustmentEnabled;

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  const integration = await getIntegrationFromDatasourceId(
    context,
    report.args.datasource,
    true
  );
  const queryRunner = new ReportQueryRunner(
    context,
    report,
    integration,
    useCache
  );

  const updatedReport = await queryRunner.startAnalysis({
    metricMap,
    factTableMap,
  });

  return res.status(200).json({
    status: 200,
    updatedReport,
  });
}

export async function putReport(
  req: AuthRequest<Partial<ReportInterface>, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const report = await getReportById(org.id, req.params.id);
  if (!report) {
    throw new Error("Unknown report id");
  }
  if (report.type !== "experiment") {
    throw new Error("Invalid report type");
  }

  const experiment = await getExperimentById(
    context,
    report.experimentId || ""
  );

  // Reports don't have projects, but the experiment does, so check the experiment's project for permission if it exists
  if (!context.permissions.canUpdateReport(experiment || {})) {
    context.permissions.throwPermissionError();
  }

  const updates: Partial<ExperimentReportInterface> = {};
  let needsRun = false;
  if ("args" in req.body) {
    updates.args = {
      ...report.args,
      ...req.body.args,
    };

    const statsEngine = updates.args?.statsEngine || DEFAULT_STATS_ENGINE;

    updates.args.startDate = getValidDate(updates.args.startDate);
    if (!updates.args.endDate) {
      delete updates.args.endDate;
    } else {
      updates.args.endDate = getValidDate(updates.args.endDate || new Date());
    }
    updates.args.statsEngine = statsEngine;
    updates.args.regressionAdjustmentEnabled = !!updates.args
      ?.regressionAdjustmentEnabled;
    updates.args.settingsForSnapshotMetrics =
      updates.args?.settingsForSnapshotMetrics || [];

    needsRun = true;
  }
  if ("title" in req.body) updates.title = req.body.title;
  if ("description" in req.body) updates.description = req.body.description;
  if ("status" in req.body) updates.status = req.body.status;

  await updateReport(org.id, req.params.id, updates);

  const updatedReport: ExperimentReportInterface = {
    ...report,
    ...updates,
  };
  if (needsRun) {
    const metricMap = await getMetricMap(context);
    const factTableMap = await getFactTableMap(context);

    const integration = await getIntegrationFromDatasourceId(
      context,
      updatedReport.args.datasource,
      true
    );

    const queryRunner = new ReportQueryRunner(
      context,
      updatedReport,
      integration
    );

    await queryRunner.startAnalysis({
      metricMap,
      factTableMap,
    });
  }

  return res.status(200).json({
    status: 200,
    updatedReport,
  });
}

export async function cancelReport(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const report = await getReportById(org.id, id);
  if (!report) {
    throw new Error("Could not cancel query");
  }
  if (report.type !== "experiment") {
    throw new Error("Invalid report type");
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    report.args.datasource
  );

  const queryRunner = new ReportQueryRunner(context, report, integration);
  await queryRunner.cancelQueries();

  res.status(200).json({ status: 200 });
}

export async function postNotebook(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const notebook = await generateReportNotebook(context, id);

  res.status(200).json({
    status: 200,
    notebook,
  });
}
