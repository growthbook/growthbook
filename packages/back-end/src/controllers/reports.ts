import { Request, Response } from "express";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { getValidDate } from "shared/dates";
import { getSnapshotAnalysis } from "shared/util";
import { pick, omit } from "lodash";
import uniqid from "uniqid";
import uniq from "lodash/uniq";
import { expandMetricGroups } from "shared/experiments";
import {
  ExperimentReportAnalysisSettings,
  ExperimentReportInterface,
  ExperimentSnapshotReportArgs,
  ExperimentSnapshotReportInterface,
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
import { ExperimentReportQueryRunner } from "back-end/src/queryRunners/ExperimentReportQueryRunner";
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
import { experimentAnalysisSettings } from "back-end/src/validators/experiments";
import { FactMetricInterface } from "back-end/types/fact-table";
import { MetricInterface } from "back-end/types/metric";
import { OrganizationSettings } from "back-end/types/organization";
import { findDimensionsByOrganization } from "back-end/src/models/DimensionModel";
import { createReportSnapshot } from "back-end/src/services/reports";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";

export async function postReportFromSnapshot(
  req: AuthRequest<ExperimentSnapshotReportArgs, { snapshot: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const reportArgs = req.body || {};

  const snapshot = await findSnapshotById(org.id, req.params.snapshot);
  if (!snapshot) {
    throw new Error("Invalid snapshot id");
  }
  // Prepare a new report-specific snapshot
  snapshot.id = uniqid("snp_");
  snapshot.type = "report";
  snapshot.triggeredBy = "manual";
  if (snapshot?.health?.traffic && !snapshot?.health?.traffic?.dimension) {
    // fix a weird corruption in the model where formerly-empty Mongoose Map comes back missing:
    snapshot.health.traffic.dimension = {};
  }

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

  const phaseIndex = snapshot.phase ?? (experiment.phases?.length || 1) - 1;
  const _experimentAnalysisSettings: ExperimentReportAnalysisSettings = {
    ...pick(experiment, Object.keys(experimentAnalysisSettings.shape)),
    trackingKey: experiment.trackingKey || experiment.id,
    ...pick(reportArgs, [
      "userIdType",
      "differenceType",
      "dimension",
      "dateStarted",
      "dateEnded",
    ]),
  } as ExperimentReportAnalysisSettings;
  if (!_experimentAnalysisSettings.dateStarted) {
    _experimentAnalysisSettings.dateStarted =
      experiment.phases?.[phaseIndex]?.dateStarted ?? new Date();
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
          "coverage",
        ])
      ),
      variations: experiment.variations.map((variation) =>
        omit(variation, ["description", "screenshots"])
      ),
    },
    experimentAnalysisSettings: _experimentAnalysisSettings,
  });

  // Save the snapshot
  snapshot.report = doc.id;
  await createExperimentSnapshotModel({ data: snapshot, context });

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
  if (report.type !== "experiment-snapshot") {
    throw new Error("Invalid report");
  }
  const context = await getContextForAgendaJobByOrgId(report.organization);

  if (report.shareLevel === "private") {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }
  // "public" and "organization" share levels are handled on the page

  const snapshot =
    report.type === "experiment-snapshot"
      ? (await findSnapshotById(report.organization, report.snapshot)) ||
        undefined
      : undefined;

  const _experiment = report.experimentId
    ? (await getExperimentById(context, report.experimentId || "")) || undefined
    : undefined;
  const experiment = pick(_experiment, ["id", "name", "type"]);

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
    (map, metric) =>
      Object.assign(map, {
        [metric.id]: omit(metric, [
          "queries",
          "runStarted",
          "analysis",
          "analysisError",
          "table",
          "column",
          "timestampColumn",
          "conditions",
          "queryFormat",
        ]),
      }),
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

  const allDimensions = await findDimensionsByOrganization(report.organization);
  const dimension = allDimensions.find((d) => d.id === snapshot?.dimension);
  const dimensions = dimension ? [dimension] : [];

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
  const orgSettings: OrganizationSettings = pick(
    context.org.settings,
    settingsKeys
  );
  // todo: consider including experiment's project settings in future? likely not...

  const ssrData: SSRExperimentReportData = {
    metrics: metricMap,
    metricGroups: metricGroups,
    factTables: factTableMap,
    settings: orgSettings,
    dimensions,
  };

  res.status(200).json({
    status: 200,
    report,
    snapshot,
    experiment,
    ssrData,
  });
}

export async function getReportPublicImage(
  req: Request<{ tinyid: string }>,
  res: Response
) {
  const { tinyid } = req.params;
  const report = await getReportByTinyid(tinyid);
  if (!report) {
    throw new Error("Unknown report id");
  }
  if (report.type !== "experiment-snapshot") {
    throw new Error("Invalid report");
  }
  const context = await getContextForAgendaJobByOrgId(report.organization);

  if (report.shareLevel === "private") {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const snapshot =
    report.type === "experiment-snapshot"
      ? (await findSnapshotById(report.organization, report.snapshot)) ||
      undefined
      : undefined;

  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="542" height="80" fill="none">
  <g clip-path="url(#a)">
    <rect width="541.261" height="79.261" x=".37" y=".37" fill="url(#b)" fill-opacity=".03" stroke="#473876" stroke-width=".739" rx="3.63"/>
    <path fill="#473876" d="M356 34h60v20h-60V34Zm-170 0h60v20h-60V34ZM16 37.695A3.695 3.695 0 0 1 19.695 34H76v20H19.695A3.695 3.695 0 0 1 16 50.305v-12.61Zm3.31 25.695v7.272h-.881v-6.35h-.043l-1.775 1.18v-.895l1.818-1.208h.88Zm4.648 0v7.272h-.88v-6.35h-.043l-1.776 1.18v-.895l1.818-1.208h.881Zm2.287 7.329a.615.615 0 0 1-.451-.188.616.616 0 0 1-.188-.451c0-.176.063-.326.188-.451a.615.615 0 0 1 .451-.189c.175 0 .325.063.451.189a.615.615 0 0 1 .188.45.664.664 0 0 1-.32.554.61.61 0 0 1-.319.086Zm4.313.042c-.469 0-.887-.08-1.254-.241a2.147 2.147 0 0 1-.87-.671 1.804 1.804 0 0 1-.348-1.005h.895c.02.234.1.437.242.607.142.168.328.298.557.39.23.093.484.14.764.14.312 0 .59-.055.83-.164.242-.11.431-.26.569-.455a1.14 1.14 0 0 0 .206-.674c0-.268-.066-.504-.2-.707a1.316 1.316 0 0 0-.582-.483c-.255-.116-.568-.174-.937-.174h-.582v-.781h.582c.289 0 .542-.052.76-.157a1.18 1.18 0 0 0 .703-1.108c0-.246-.054-.46-.163-.642a1.117 1.117 0 0 0-.462-.426 1.494 1.494 0 0 0-.696-.153c-.25 0-.488.046-.71.138-.22.09-.4.222-.54.395-.14.17-.215.376-.227.617h-.852c.014-.38.129-.714.344-1.001.215-.289.497-.514.845-.675a2.73 2.73 0 0 1 1.154-.241c.45 0 .836.091 1.158.273.322.18.57.418.742.714.173.296.26.616.26.959 0 .41-.108.759-.324 1.047a1.637 1.637 0 0 1-.87.6v.057c.46.076.818.272 1.076.586.258.313.387.7.387 1.162 0 .395-.107.75-.323 1.065a2.195 2.195 0 0 1-.873.739c-.37.18-.79.27-1.261.27Zm3.74-1.59v-.725l3.195-5.057h.526v1.122h-.355l-2.415 3.821v.057h4.304v.782h-5.256Zm3.422 1.491v-7.273h.839v7.273h-.838Zm6.871-1.364v-.383c0-.265.054-.508.163-.728.112-.223.273-.4.483-.533.213-.135.471-.202.774-.202.308 0 .566.067.775.202.208.133.365.31.472.533.106.22.16.463.16.728v.383c0 .266-.055.51-.164.732a1.29 1.29 0 0 1-.475.533c-.209.132-.464.198-.768.198-.307 0-.567-.066-.777-.198a1.315 1.315 0 0 1-.48-.533 1.642 1.642 0 0 1-.163-.732Zm.724-.383v.383c0 .22.053.418.157.593.104.173.284.26.54.26.248 0 .423-.087.525-.26a1.14 1.14 0 0 0 .156-.593v-.383c0-.22-.05-.417-.149-.59-.1-.175-.277-.262-.532-.262-.249 0-.428.087-.537.262-.106.173-.16.37-.16.59Zm-4.346-3.779v-.383c0-.265.054-.508.163-.728.111-.223.273-.4.483-.533.213-.135.471-.202.774-.202.308 0 .566.067.774.202.209.133.366.31.473.533.106.22.16.463.16.728v.383c0 .266-.055.51-.164.732a1.29 1.29 0 0 1-.476.533 1.405 1.405 0 0 1-.767.199c-.307 0-.567-.067-.777-.2a1.315 1.315 0 0 1-.48-.532 1.642 1.642 0 0 1-.163-.732Zm.724-.383v.383c0 .22.052.418.157.594.104.172.284.259.54.259.248 0 .423-.087.525-.26.104-.175.156-.372.156-.593v-.383c0-.22-.05-.417-.149-.59-.1-.175-.277-.262-.533-.262-.248 0-.427.087-.536.262a1.1 1.1 0 0 0-.16.59Zm-.454 5.909 5-7.273h.81l-5 7.273h-.81Zm147.735-7.272v7.272h-.88v-6.35h-.043l-1.775 1.18v-.895l1.818-1.208h.88Zm4.649 0v7.272h-.881v-6.35h-.042l-1.776 1.18v-.895l1.818-1.208h.881Zm2.287 7.329a.615.615 0 0 1-.451-.188.613.613 0 0 1-.188-.451c0-.176.062-.326.188-.451a.615.615 0 0 1 .451-.189c.175 0 .325.063.451.189a.617.617 0 0 1 .188.45.666.666 0 0 1-.32.554.606.606 0 0 1-.319.086Zm4.313.042c-.469 0-.887-.08-1.254-.241a2.155 2.155 0 0 1-.87-.671 1.805 1.805 0 0 1-.348-1.005h.895c.019.234.099.437.241.607.142.168.328.298.558.39.23.093.484.14.763.14.313 0 .59-.055.831-.164.242-.11.431-.26.569-.455a1.14 1.14 0 0 0 .206-.674 1.27 1.27 0 0 0-.199-.707 1.319 1.319 0 0 0-.583-.483c-.255-.116-.568-.174-.937-.174h-.583v-.781h.583c.289 0 .542-.052.76-.157.22-.104.392-.25.515-.44.125-.19.188-.412.188-.668 0-.246-.055-.46-.163-.642a1.118 1.118 0 0 0-.462-.426 1.497 1.497 0 0 0-.696-.153 1.83 1.83 0 0 0-.71.138c-.221.09-.4.222-.54.395a1.02 1.02 0 0 0-.227.617h-.853c.015-.38.129-.714.345-1.001.215-.289.497-.514.845-.675a2.73 2.73 0 0 1 1.154-.241c.45 0 .836.091 1.158.273.322.18.569.418.742.714.173.296.259.616.259.959 0 .41-.108.759-.323 1.047a1.637 1.637 0 0 1-.87.6v.057c.459.076.818.272 1.076.586.258.313.387.7.387 1.162 0 .395-.108.75-.323 1.065a2.191 2.191 0 0 1-.874.739c-.369.18-.789.27-1.26.27Zm6.367 0c-.469 0-.887-.08-1.254-.241a2.155 2.155 0 0 1-.87-.671 1.805 1.805 0 0 1-.348-1.005h.895c.019.234.1.437.242.607.142.168.328.298.557.39.23.093.484.14.764.14.312 0 .589-.055.831-.164.241-.11.43-.26.568-.455a1.14 1.14 0 0 0 .206-.674 1.27 1.27 0 0 0-.199-.707 1.322 1.322 0 0 0-.582-.483c-.256-.116-.569-.174-.938-.174h-.582v-.781h.582c.289 0 .542-.052.76-.157.22-.104.392-.25.515-.44.125-.19.188-.412.188-.668 0-.246-.054-.46-.163-.642a1.118 1.118 0 0 0-.462-.426 1.491 1.491 0 0 0-.696-.153 1.83 1.83 0 0 0-.71.138c-.22.09-.4.222-.54.395-.14.17-.215.376-.227.617h-.852c.014-.38.129-.714.344-1.001.215-.289.497-.514.845-.675a2.732 2.732 0 0 1 1.154-.241c.45 0 .836.091 1.158.273.322.18.569.418.742.714.173.296.259.616.259.959 0 .41-.107.759-.323 1.047a1.637 1.637 0 0 1-.87.6v.057c.459.076.818.272 1.076.586.258.313.387.7.387 1.162 0 .395-.107.75-.323 1.065a2.195 2.195 0 0 1-.873.739c-.37.18-.79.27-1.261.27Zm7.617-1.463v-.383c0-.265.055-.508.163-.728.112-.223.273-.4.483-.533.213-.135.471-.202.775-.202.307 0 .565.067.774.202.208.133.365.31.472.533.106.22.16.463.16.728v.383c0 .266-.055.51-.164.732a1.29 1.29 0 0 1-.475.533c-.209.132-.464.198-.767.198-.308 0-.567-.066-.778-.198a1.315 1.315 0 0 1-.48-.533 1.654 1.654 0 0 1-.163-.732Zm.724-.383v.383c0 .22.053.418.157.593.104.173.284.26.54.26.248 0 .423-.087.525-.26a1.14 1.14 0 0 0 .156-.593v-.383c0-.22-.049-.417-.149-.59-.099-.175-.277-.262-.532-.262-.249 0-.428.087-.537.262-.106.173-.16.37-.16.59Zm-4.346-3.779v-.383c0-.265.054-.508.163-.728.112-.223.273-.4.483-.533.213-.135.471-.202.774-.202.308 0 .566.067.774.202.209.133.366.31.473.533.106.22.16.463.16.728v.383c0 .266-.055.51-.164.732-.106.22-.265.398-.476.533a1.405 1.405 0 0 1-.767.199c-.307 0-.567-.067-.777-.2a1.315 1.315 0 0 1-.48-.532 1.64 1.64 0 0 1-.163-.732Zm.724-.383v.383c0 .22.052.418.157.594.104.172.284.259.539.259.249 0 .424-.087.526-.26a1.14 1.14 0 0 0 .156-.593v-.383c0-.22-.05-.417-.149-.59-.099-.175-.277-.262-.533-.262-.248 0-.427.087-.536.262-.106.173-.16.37-.16.59Zm-.454 5.909 5-7.273h.809l-5 7.273h-.809Zm148.455-6.935V71h-.881v-6.35h-.043l-1.775 1.18v-.895l1.818-1.208h.881Zm4.648 0V71h-.881v-6.35h-.042l-1.776 1.18v-.895l1.818-1.208h.881Zm2.287 7.33a.616.616 0 0 1-.451-.188.617.617 0 0 1-.188-.451c0-.176.063-.326.188-.451a.616.616 0 0 1 .451-.189c.175 0 .326.063.451.189a.617.617 0 0 1 .188.45.595.595 0 0 1-.089.32.655.655 0 0 1-.23.235.612.612 0 0 1-.32.085Zm4.313.042c-.469 0-.887-.08-1.254-.241a2.156 2.156 0 0 1-.87-.671 1.805 1.805 0 0 1-.348-1.005h.895c.019.234.1.437.242.607.142.168.328.298.557.39.23.093.484.14.764.14.312 0 .589-.055.831-.164.241-.11.431-.26.568-.455a1.14 1.14 0 0 0 .206-.674c0-.268-.066-.504-.199-.707a1.322 1.322 0 0 0-.582-.483c-.256-.116-.569-.174-.938-.174h-.582v-.781h.582c.289 0 .542-.052.76-.157.22-.104.392-.25.515-.44.125-.19.188-.412.188-.668 0-.246-.054-.46-.163-.642a1.118 1.118 0 0 0-.462-.426 1.491 1.491 0 0 0-.696-.153c-.251 0-.488.046-.71.138-.22.09-.4.222-.54.395-.14.17-.215.376-.227.618h-.852c.014-.382.129-.716.344-1.002.215-.289.497-.514.845-.675a2.732 2.732 0 0 1 1.154-.241c.45 0 .836.091 1.158.273.322.18.569.418.742.714.173.296.259.616.259.959 0 .41-.107.759-.323 1.047a1.637 1.637 0 0 1-.87.6v.057c.459.076.818.271 1.076.586.258.313.387.7.387 1.162 0 .395-.107.75-.323 1.065a2.195 2.195 0 0 1-.873.739c-.37.18-.79.27-1.261.27Zm6.367 0c-.469 0-.887-.08-1.253-.241a2.152 2.152 0 0 1-.871-.671 1.805 1.805 0 0 1-.348-1.005h.895c.019.234.1.437.242.607.142.168.328.298.557.39.23.093.485.14.764.14.312 0 .589-.055.831-.164.241-.11.431-.26.568-.455a1.14 1.14 0 0 0 .206-.674c0-.268-.066-.504-.199-.707a1.316 1.316 0 0 0-.582-.483c-.256-.116-.568-.174-.938-.174h-.582v-.781h.582c.289 0 .542-.052.76-.157a1.176 1.176 0 0 0 .703-1.108c0-.246-.054-.46-.163-.642a1.118 1.118 0 0 0-.462-.426 1.491 1.491 0 0 0-.696-.153 1.84 1.84 0 0 0-.71.138c-.22.09-.4.222-.54.395a1.03 1.03 0 0 0-.227.618h-.852c.014-.382.129-.716.344-1.002.216-.289.497-.514.845-.675a2.732 2.732 0 0 1 1.154-.241c.45 0 .836.091 1.158.273.322.18.57.418.742.714.173.296.26.616.26.959 0 .41-.108.759-.324 1.047a1.637 1.637 0 0 1-.87.6v.057c.46.076.818.271 1.076.586.258.313.387.7.387 1.162 0 .395-.107.75-.323 1.065a2.195 2.195 0 0 1-.873.739c-.37.18-.79.27-1.261.27Zm7.617-1.463v-.383c0-.265.055-.508.164-.728.111-.223.272-.4.483-.533.213-.135.471-.202.774-.202.307 0 .566.067.774.202.208.133.366.31.472.533.107.22.16.463.16.728v.383c0 .266-.054.51-.163.732a1.3 1.3 0 0 1-.476.533c-.209.132-.464.198-.767.198-.308 0-.567-.066-.778-.198a1.313 1.313 0 0 1-.479-.533 1.64 1.64 0 0 1-.164-.732Zm.725-.383v.383c0 .22.052.418.156.593.104.173.284.26.54.26.248 0 .423-.087.525-.26a1.14 1.14 0 0 0 .157-.593v-.383c0-.22-.05-.417-.15-.59-.099-.175-.277-.262-.532-.262-.249 0-.428.087-.537.262-.106.173-.159.37-.159.59Zm-4.347-3.779v-.383c0-.265.055-.508.163-.728.112-.223.273-.4.483-.533a1.42 1.42 0 0 1 .775-.202c.307 0 .565.067.774.202.208.133.365.31.472.533.107.22.16.463.16.728v.383c0 .266-.055.51-.164.732-.106.22-.265.398-.475.533-.209.132-.464.198-.767.198-.308 0-.567-.066-.778-.198a1.315 1.315 0 0 1-.48-.533 1.654 1.654 0 0 1-.163-.732Zm.725-.383v.383c0 .22.052.418.156.593.104.173.284.26.54.26.248 0 .423-.087.525-.26a1.14 1.14 0 0 0 .156-.593v-.383c0-.22-.049-.417-.149-.59-.099-.175-.277-.262-.532-.262-.249 0-.428.087-.537.262-.106.173-.159.37-.159.59ZM381.19 71l5-7.273h.81L382 71h-.81ZM16.438 16.363v-1.215h6.382v1.215h-2.472v6.785H18.91v-6.785h-2.473Zm6.927 6.785v-6h1.371v1h.063a1.5 1.5 0 0 1 1.48-1.086c.078 0 .166.004.262.012.099.005.181.014.246.027v1.301a1.587 1.587 0 0 0-.285-.055 2.629 2.629 0 0 0-.371-.027c-.258 0-.49.056-.695.168a1.23 1.23 0 0 0-.48.457c-.118.195-.177.42-.177.676v3.527h-1.414Zm5.98.121c-.38 0-.722-.067-1.027-.203a1.678 1.678 0 0 1-.718-.61c-.175-.267-.262-.598-.262-.991 0-.339.062-.619.187-.84.125-.222.296-.399.512-.532.216-.132.46-.233.73-.3.274-.07.557-.121.848-.153.352-.036.637-.069.856-.097.218-.031.377-.078.476-.14.102-.066.153-.166.153-.302v-.023c0-.294-.088-.522-.262-.684-.175-.161-.426-.242-.754-.242-.346 0-.621.076-.824.227-.2.15-.336.33-.407.535l-1.32-.188c.104-.364.276-.669.516-.914a2.24 2.24 0 0 1 .879-.554 3.36 3.36 0 0 1 1.148-.188c.29 0 .577.034.863.102.287.067.549.18.786.336.237.153.427.363.57.629.146.265.219.597.219.996v4.015h-1.36v-.824h-.047a1.725 1.725 0 0 1-.363.469 1.748 1.748 0 0 1-.582.347 2.347 2.347 0 0 1-.816.13Zm.368-1.039c.284 0 .53-.056.738-.168a1.221 1.221 0 0 0 .652-1.066v-.707a.666.666 0 0 1-.226.101 3.213 3.213 0 0 1-.352.082c-.13.024-.259.045-.386.063l-.332.047a2.45 2.45 0 0 0-.567.14.942.942 0 0 0-.394.274.668.668 0 0 0-.145.445c0 .26.095.457.285.59.19.133.433.2.727.2Zm7.262-5.082v1.094h-3.547v-1.094h3.547Zm-2.66 6v-6.566c0-.404.083-.74.25-1.008.169-.268.395-.469.68-.602.283-.132.598-.199.945-.199.244 0 .462.02.652.059.19.039.33.074.422.105l-.282 1.094a2.449 2.449 0 0 0-.226-.055 1.372 1.372 0 0 0-.305-.03c-.263 0-.449.063-.558.19-.107.126-.16.305-.16.54v6.472h-1.418Zm6.806-6v1.094h-3.547v-1.094h3.547Zm-2.66 6v-6.566c0-.404.083-.74.25-1.008a1.59 1.59 0 0 1 .68-.602c.284-.132.599-.199.945-.199.245 0 .462.02.652.059.19.039.331.074.422.105l-.281 1.094a2.444 2.444 0 0 0-.227-.055 1.371 1.371 0 0 0-.304-.03c-.263 0-.45.063-.559.19-.107.126-.16.305-.16.54v6.472H38.46Zm3.767 0v-6h1.415v6h-1.415Zm.712-6.851a.825.825 0 0 1-.579-.223.718.718 0 0 1-.242-.543.71.71 0 0 1 .242-.543.817.817 0 0 1 .579-.226c.226 0 .419.075.578.226a.71.71 0 0 1 .242.543.72.72 0 0 1-.242.543.816.816 0 0 1-.578.223Zm4.774 6.968c-.6 0-1.113-.131-1.543-.394a2.635 2.635 0 0 1-.988-1.09c-.23-.466-.344-1.003-.344-1.61 0-.609.117-1.146.351-1.613a2.63 2.63 0 0 1 .993-1.093c.43-.263.937-.395 1.523-.395.487 0 .918.09 1.293.27.378.177.678.428.902.753.224.323.352.701.383 1.133h-1.351a1.292 1.292 0 0 0-.391-.722c-.203-.196-.475-.293-.816-.293-.29 0-.543.078-.762.234a1.5 1.5 0 0 0-.512.664c-.12.29-.18.635-.18 1.04 0 .408.06.76.18 1.054.12.291.288.517.504.676.219.156.475.234.77.234.208 0 .394-.039.558-.117.167-.08.306-.197.418-.348.112-.15.189-.334.23-.55h1.352c-.034.424-.159.8-.375 1.128a2.22 2.22 0 0 1-.883.766c-.372.182-.81.273-1.312.273Zm10.87-5.918a1.067 1.067 0 0 0-.461-.797c-.268-.19-.617-.285-1.047-.285-.302 0-.561.046-.777.137a1.15 1.15 0 0 0-.496.371.903.903 0 0 0-.063.969c.078.122.184.226.317.312.133.084.28.154.441.211.162.058.324.106.488.145l.75.187c.302.07.593.166.871.286.282.12.533.27.754.453.224.182.401.402.532.66.13.258.195.56.195.906 0 .469-.12.882-.36 1.238-.24.354-.585.632-1.038.832-.451.198-.997.297-1.637.297-.623 0-1.163-.096-1.621-.289a2.414 2.414 0 0 1-1.07-.843c-.256-.37-.394-.82-.415-1.352h1.426c.02.279.107.51.258.695.15.185.347.323.59.414.245.091.518.137.82.137.315 0 .591-.047.828-.14.24-.097.427-.23.563-.4a.962.962 0 0 0 .207-.6.764.764 0 0 0-.184-.516 1.345 1.345 0 0 0-.504-.344 4.864 4.864 0 0 0-.75-.25l-.91-.234c-.659-.17-1.18-.426-1.563-.77-.38-.346-.57-.806-.57-1.379 0-.471.128-.884.383-1.238a2.53 2.53 0 0 1 1.05-.824 3.648 3.648 0 0 1 1.505-.297c.567 0 1.065.099 1.492.297.43.195.767.467 1.012.816.244.346.37.745.378 1.195h-1.394Zm2.733 8.051v-8.25h1.391v.992h.082c.073-.146.176-.3.309-.465.132-.166.312-.308.539-.425.226-.12.515-.18.867-.18.463 0 .881.119 1.254.355.375.235.672.583.89 1.043.222.459.332 1.021.332 1.688 0 .659-.108 1.219-.324 1.68-.216.46-.51.812-.883 1.054a2.27 2.27 0 0 1-1.265.364c-.344 0-.63-.058-.856-.172a1.742 1.742 0 0 1-.547-.414 2.685 2.685 0 0 1-.316-.465h-.059v3.195h-1.414Zm1.387-5.25c0 .388.055.728.164 1.02.112.291.272.52.48.683.212.162.467.242.766.242.313 0 .575-.083.785-.25.211-.169.37-.4.477-.69.11-.295.164-.63.164-1.005 0-.372-.053-.703-.16-.992a1.49 1.49 0 0 0-.477-.68c-.21-.164-.474-.246-.789-.246-.302 0-.558.08-.77.238-.21.16-.37.382-.48.669-.106.286-.16.623-.16 1.011Zm6.902-5v8h-1.414v-8h1.414Zm1.455 8v-6h1.414v6H71.06Zm.71-6.851a.825.825 0 0 1-.578-.223.718.718 0 0 1-.242-.543.71.71 0 0 1 .242-.543.817.817 0 0 1 .579-.226c.226 0 .419.075.578.226a.71.71 0 0 1 .242.543c0 .21-.08.392-.242.543a.816.816 0 0 1-.578.223Zm5.154.851v1.094h-3.45v-1.094h3.45Zm-2.598-1.437h1.414v5.632c0 .19.029.336.086.438.06.099.138.167.234.203a.898.898 0 0 0 .32.055 1.85 1.85 0 0 0 .415-.055l.238 1.106a3.155 3.155 0 0 1-.324.085 2.65 2.65 0 0 1-.508.055 2.306 2.306 0 0 1-.957-.16 1.49 1.49 0 0 1-.676-.555c-.164-.25-.245-.562-.242-.937V15.71Zm6.571 7.437v-8h3c.615 0 1.13.115 1.547.344.42.23.736.544.95.945.216.399.324.852.324 1.36 0 .513-.108.968-.325 1.367a2.315 2.315 0 0 1-.957.941c-.421.227-.94.34-1.558.34H81.89v-1.191h1.793c.359 0 .653-.063.882-.188a1.18 1.18 0 0 0 .508-.515c.112-.22.168-.47.168-.754 0-.284-.056-.534-.168-.75a1.141 1.141 0 0 0-.511-.504c-.23-.123-.525-.184-.887-.184h-1.328v6.79h-1.45Zm7.017 0v-6h1.371v1h.063a1.49 1.49 0 0 1 .562-.8c.268-.19.574-.286.918-.286.078 0 .166.004.262.012.099.005.18.014.246.027v1.301a1.587 1.587 0 0 0-.285-.055 2.628 2.628 0 0 0-.371-.027c-.258 0-.49.056-.696.168a1.23 1.23 0 0 0-.48.457c-.117.195-.176.42-.176.676v3.527h-1.414Zm6.77.117c-.601 0-1.12-.125-1.558-.375a2.54 2.54 0 0 1-1.004-1.07c-.234-.463-.352-1.009-.352-1.637 0-.617.118-1.159.352-1.625a2.66 2.66 0 0 1 .992-1.093c.425-.263.923-.395 1.496-.395.37 0 .72.06 1.047.18.33.117.623.3.875.547.255.247.456.562.602.945.146.38.218.833.218 1.36v.433h-4.917v-.953h3.562a1.522 1.522 0 0 0-.176-.723 1.279 1.279 0 0 0-.48-.504 1.35 1.35 0 0 0-.711-.183c-.29 0-.543.07-.762.21-.219.139-.39.32-.512.547-.12.224-.18.47-.183.739v.832c0 .349.064.648.191.898.128.248.306.438.535.57.23.13.498.196.805.196.206 0 .392-.029.559-.086.166-.06.31-.147.433-.262a1.09 1.09 0 0 0 .278-.426l1.32.149a2.058 2.058 0 0 1-.477.914 2.324 2.324 0 0 1-.89.601 3.41 3.41 0 0 1-1.242.211Zm9.052-6.117-2.136 6h-1.563l-2.137-6h1.508l1.379 4.457h.063l1.382-4.457h1.504Zm.979 6v-6h1.414v6h-1.414Zm.711-6.851a.824.824 0 0 1-.578-.223.717.717 0 0 1-.243-.543c0-.213.081-.395.243-.543a.816.816 0 0 1 .578-.226.81.81 0 0 1 .578.226c.161.149.242.33.242.543a.72.72 0 0 1-.242.543.817.817 0 0 1-.578.223Zm4.813 6.968c-.601 0-1.121-.125-1.558-.375a2.537 2.537 0 0 1-1.004-1.07c-.235-.463-.352-1.009-.352-1.637 0-.617.117-1.159.352-1.625.237-.468.567-.833.992-1.093.424-.263.923-.395 1.496-.395.37 0 .719.06 1.047.18.331.117.622.3.875.547.255.247.456.562.601.945.146.38.219.833.219 1.36v.433h-4.918v-.953h3.563a1.521 1.521 0 0 0-.176-.723 1.28 1.28 0 0 0-.481-.504 1.349 1.349 0 0 0-.71-.183c-.29 0-.543.07-.762.21-.219.139-.389.32-.512.547-.12.224-.181.47-.183.739v.832c0 .349.063.648.191.898.128.248.306.438.535.57a1.6 1.6 0 0 0 .805.196c.205 0 .392-.029.558-.086a1.23 1.23 0 0 0 .434-.262 1.08 1.08 0 0 0 .277-.426l1.321.149a2.07 2.07 0 0 1-.477.914 2.326 2.326 0 0 1-.891.601 3.41 3.41 0 0 1-1.242.211Zm5.071-.117-1.696-6h1.442l1.054 4.219h.055l1.078-4.219h1.426l1.078 4.195h.059l1.039-4.195h1.445l-1.699 6h-1.473l-1.125-4.055h-.082l-1.125 4.055h-1.476Z"/>
    <path fill="#853FF9" fill-opacity=".09" d="M246 34h110v20H246zm170 0h106a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H416V34ZM76 34h110v20H76z"/>
  </g>
  <defs>
    <linearGradient id="b" x1="271" x2="271" y1="80" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#853FF9" stop-opacity=".09"/>
      <stop offset="1" stop-color="#42F" stop-opacity=".06"/>
    </linearGradient>
    <clipPath id="a">
      <path fill="#fff" d="M0 0h542v80H0z"/>
    </clipPath>
  </defs>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.status(200).send(svg);
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
  if (!report) throw new Error("Unknown report id");

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);
  const useCache = !req.query["force"];

  if (report.type === "experiment-snapshot") {
    const snapshot =
      (await findSnapshotById(report.organization, report.snapshot)) ||
      undefined;

    try {
      const newSnapshot = await createReportSnapshot({
        report,
        previousSnapshot: snapshot,
        context,
        metricMap,
        factTableMap,
      });

      return res.status(200).json({
        status: 200,
        snapshot: newSnapshot,
      });
    } catch (e) {
      req.log.error(e, "Failed to create report snapshot");
      return res.status(400).json({
        status: 400,
        message: e.message,
      });
    }
  } else if (report.type === "experiment") {
    report.args.statsEngine = report.args?.statsEngine || DEFAULT_STATS_ENGINE;
    report.args.regressionAdjustmentEnabled = !!report.args
      ?.regressionAdjustmentEnabled;

    const integration = await getIntegrationFromDatasourceId(
      context,
      report.args.datasource,
      true
    );
    const queryRunner = new ExperimentReportQueryRunner(
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

  throw new Error("Invalid report type");
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
  if (report.type === "experiment-snapshot") {
    const data = req.body as ExperimentSnapshotReportInterface;
    if (!data) {
      throw new Error("Malformed data");
    }
    const updates: Partial<ExperimentSnapshotReportInterface> = {
      ...pick(data, [
        "title",
        "description",
        "shareLevel",
        "editLevel",
        "status",
        "snapshot",
      ]),
    };
    if (data?.experimentMetadata?.phases) {
      updates.experimentMetadata = {
        ...report.experimentMetadata,
        phases: report.experimentMetadata.phases.map((phase, i) => {
          if (i === report.experimentMetadata.phases.length - 1) {
            return {
              ...phase,
              ...pick(data.experimentMetadata.phases?.[i] || {}, [
                "variationWeights",
                "coverage",
              ]),
            };
          }
          return phase;
        }),
      };
    }
    if (data?.experimentMetadata?.variations) {
      updates.experimentMetadata = updates.experimentMetadata ?? {
        ...report.experimentMetadata,
      };
      updates.experimentMetadata = {
        ...updates.experimentMetadata,
        variations: data?.experimentMetadata?.variations,
      };
    }
    if (data?.experimentAnalysisSettings) {
      updates.experimentAnalysisSettings = {
        ...report.experimentAnalysisSettings,
        ...pick(data.experimentAnalysisSettings, [
          ...Object.keys(experimentAnalysisSettings.shape),
          "userIdType",
          "differenceType",
          "dimension",
          "dateStarted",
          "dateEnded",
        ]),
      };
      updates.experimentAnalysisSettings.dateStarted = getValidDate(
        updates.experimentAnalysisSettings.dateStarted
      );
      if (updates.experimentAnalysisSettings.dateEnded) {
        updates.experimentAnalysisSettings.dateEnded = getValidDate(
          updates.experimentAnalysisSettings.dateEnded
        );
      }
    }

    updates.dateUpdated = new Date();

    await updateReport(org.id, req.params.id, updates);
    const updatedReport: ExperimentSnapshotReportInterface = {
      ...report,
      ...updates,
    };

    return res.status(200).json({
      status: 200,
      updatedReport,
    });
  } else if (report.type === "experiment") {
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

      const queryRunner = new ExperimentReportQueryRunner(
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

  throw new Error("Invalid report type");
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

  if (report.type === "experiment-snapshot") {
    const snapshot =
      (await findSnapshotById(report.organization, report.snapshot)) ||
      undefined;

    const datasourceId = snapshot?.settings?.datasourceId;
    if (!datasourceId) {
      res.status(403).json({
        status: 403,
        message: "Invalid datasource: " + datasourceId,
      });
      return;
    }

    const integration = await getIntegrationFromDatasourceId(
      context,
      datasourceId,
      true
    );

    const queryRunner = new ExperimentResultsQueryRunner(
      context,
      snapshot,
      integration
    );
    await queryRunner.cancelQueries();

    return res.status(200).json({ status: 200 });
  } else if (report.type === "experiment") {
    const integration = await getIntegrationFromDatasourceId(
      context,
      report.args.datasource
    );

    const queryRunner = new ExperimentReportQueryRunner(
      context,
      report,
      integration
    );
    await queryRunner.cancelQueries();

    return res.status(200).json({ status: 200 });
  }

  throw new Error("Invalid report type");
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
