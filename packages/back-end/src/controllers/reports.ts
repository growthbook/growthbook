import { Request, Response } from "express";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { getValidDate } from "shared/dates";
import { getSnapshotAnalysis } from "shared/util";
import { pick, omit } from "lodash";
import uniqid from "uniqid";
import { experimentAnalysisSettings } from "shared/validators";
import {
  ExperimentReportAnalysisSettings,
  ExperimentReportInterface,
  ExperimentSnapshotReportArgs,
  ExperimentSnapshotReportInterface,
  ReportInterface,
} from "back-end/types/report";
import {
  getExperimentById,
  getExperimentsByIds,
} from "back-end/src/models/ExperimentModel";
import {
  createExperimentSnapshotModel,
  findLatestRunningSnapshotByReportId,
  findSnapshotById,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
  createReport,
  deleteReportById,
  getReportById,
  getReportByUid,
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
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import {
  createReportSnapshot,
  generateExperimentReportSSRData,
} from "back-end/src/services/reports";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { getAdditionalQueryMetadataForExperiment } from "back-end/src/services/experiments";

export async function postReportFromSnapshot(
  req: AuthRequest<ExperimentSnapshotReportArgs, { snapshot: string }>,
  res: Response,
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

  const analysis = getSnapshotAnalysis(
    snapshot,
    snapshot.analyses.find(
      (a) => a.settings.differenceType === reportArgs.differenceType,
    )?.settings,
  );
  if (!analysis) {
    throw new Error("Missing analysis settings");
  }

  const phaseIndex = snapshot.phase ?? (experiment.phases?.length || 1) - 1;
  const _experimentAnalysisSettings: ExperimentReportAnalysisSettings = {
    ...pick(experiment, Object.keys(experimentAnalysisSettings.shape)),
    statsEngine: analysis.settings.statsEngine,
    trackingKey: experiment.trackingKey || experiment.id,
    ...pick(reportArgs, [
      "userIdType",
      "differenceType",
      "dimension",
      "dateStarted",
      "dateEnded",
      "customMetricSlices",
      "pinnedMetricSlices",
    ]),
  } as ExperimentReportAnalysisSettings;
  if (!_experimentAnalysisSettings.dateStarted) {
    _experimentAnalysisSettings.dateStarted =
      experiment.phases?.[phaseIndex]?.dateStarted ?? new Date();
  }
  if (
    !_experimentAnalysisSettings.dateEnded &&
    experiment?.status === "stopped" &&
    experiment.phases?.[phaseIndex]?.dateEnded
  ) {
    _experimentAnalysisSettings.dateEnded =
      experiment.phases?.[phaseIndex]?.dateEnded;
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
        ]),
      ),
      variations: experiment.variations.map((variation) =>
        omit(variation, ["description", "screenshots"]),
      ),
    },
    experimentAnalysisSettings: _experimentAnalysisSettings,
  });

  // Save the snapshot
  snapshot.report = doc.id;
  await createExperimentSnapshotModel({ data: snapshot });

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
  res: Response,
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
  res: Response,
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
  res: Response,
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
  req: Request<{ uid: string }>,
  res: Response,
) {
  const { uid } = req.params;
  const report = await getReportByUid(uid);
  if (!report || report.type !== "experiment-snapshot") {
    return res.status(404).json({
      status: 404,
      message: "Report not found",
    });
  }
  if (report.shareLevel !== "public") {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }
  const context = await getContextForAgendaJobByOrgId(report.organization);

  const snapshot =
    report.type === "experiment-snapshot"
      ? (await findSnapshotById(report.organization, report.snapshot)) ||
        undefined
      : undefined;

  const _experiment = report.experimentId
    ? (await getExperimentById(context, report.experimentId || "")) || undefined
    : undefined;
  const experiment = pick(_experiment, ["id", "name", "type"]);

  const ssrData = await generateExperimentReportSSRData({
    context,
    organization: report.organization,
    snapshot,
  });

  res.status(200).json({
    status: 200,
    report,
    snapshot,
    experiment,
    ssrData,
  });
}

export async function deleteReport(
  req: AuthRequest<null, { id: string }>,
  res: Response,
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
    report.experimentId || "",
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
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const report = await getReportById(org.id, req.params.id);
  if (!report) throw new Error("Unknown report id");

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);
  const metricGroups = await context.models.metricGroups.getAll();
  const useCache = !req.query["force"];

  if (report.type === "experiment-snapshot") {
    const experiment = await getExperimentById(
      context,
      report.experimentId || "",
    );
    const isOwner = report.userId === req.userId;
    const canUpdateReport = context.permissions.canUpdateReport(
      experiment || {},
    );
    if (
      !(isOwner || (report.editLevel === "organization" && canUpdateReport))
    ) {
      context.permissions.throwPermissionError();
    }

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
    report.args.regressionAdjustmentEnabled =
      !!report.args?.regressionAdjustmentEnabled;

    const integration = await getIntegrationFromDatasourceId(
      context,
      report.args.datasource,
      true,
    );
    const queryRunner = new ExperimentReportQueryRunner(
      context,
      report,
      integration,
      useCache,
    );

    const updatedReport = await queryRunner.startAnalysis({
      metricMap,
      factTableMap,
      metricGroups,
      experimentQueryMetadata: null,
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
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const report = await getReportById(org.id, req.params.id);
  if (!report) {
    throw new Error("Unknown report id");
  }
  if (report.type === "experiment-snapshot") {
    const experiment = await getExperimentById(
      context,
      report.experimentId || "",
    );
    const isOwner = report.userId === req.userId;
    const canUpdateReport = context.permissions.canUpdateReport(
      experiment || {},
    );
    if (
      !(isOwner || (report.editLevel === "organization" && canUpdateReport))
    ) {
      context.permissions.throwPermissionError();
    }

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
          "customMetricSlices",
          "pinnedMetricSlices",
        ]),
      };
      updates.experimentAnalysisSettings.dateStarted = getValidDate(
        updates.experimentAnalysisSettings.dateStarted,
      );
      if (updates.experimentAnalysisSettings.dateEnded) {
        updates.experimentAnalysisSettings.dateEnded = getValidDate(
          updates.experimentAnalysisSettings.dateEnded,
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
      report.experimentId || "",
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
      updates.args.regressionAdjustmentEnabled =
        !!updates.args?.regressionAdjustmentEnabled;
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
      const metricGroups = await context.models.metricGroups.getAll();

      const integration = await getIntegrationFromDatasourceId(
        context,
        updatedReport.args.datasource,
        true,
      );

      const queryRunner = new ExperimentReportQueryRunner(
        context,
        updatedReport,
        integration,
      );

      await queryRunner.startAnalysis({
        metricMap,
        factTableMap,
        metricGroups,
        experimentQueryMetadata: experiment
          ? getAdditionalQueryMetadataForExperiment(experiment)
          : null,
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
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const report = await getReportById(org.id, id);
  if (!report) {
    throw new Error("Could not cancel query");
  }

  if (report.type === "experiment-snapshot") {
    const snapshot = report.snapshot
      ? (await findLatestRunningSnapshotByReportId(
          report.organization,
          report.id,
        )) || undefined
      : undefined;
    if (!snapshot) {
      return res.status(400).json({
        status: 400,
        message: "No running query found",
      });
    }

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
      true,
    );

    const queryRunner = new ExperimentResultsQueryRunner(
      context,
      snapshot,
      integration,
    );
    await queryRunner.cancelQueries();

    return res.status(200).json({ status: 200 });
  } else if (report.type === "experiment") {
    const integration = await getIntegrationFromDatasourceId(
      context,
      report.args.datasource,
    );

    const queryRunner = new ExperimentReportQueryRunner(
      context,
      report,
      integration,
    );
    await queryRunner.cancelQueries();

    return res.status(200).json({ status: 200 });
  }

  throw new Error("Invalid report type");
}

export async function postNotebook(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const notebook = await generateReportNotebook(context, id);

  res.status(200).json({
    status: 200,
    notebook,
  });
}
