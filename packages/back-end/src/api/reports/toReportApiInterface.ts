import { ApiReport } from "shared/validators";
import { ReportInterface } from "shared/types/report";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { APP_ORIGIN } from "back-end/src/util/secrets";

export function toReportApiInterface(
  report: ReportInterface,
  snapshot?: ExperimentSnapshotInterface | null,
): ApiReport {
  // Reports persisted before share controls existed have undefined shareLevel.
  // Treat those as "private" in the API surface so we never silently expose them.
  const shareLevel: ApiReport["shareLevel"] =
    report.type === "experiment-snapshot" && report.shareLevel
      ? report.shareLevel
      : "private";

  const base: ApiReport = {
    id: report.id,
    dateCreated:
      report.dateCreated?.toISOString?.() ?? String(report.dateCreated),
    dateUpdated:
      report.dateUpdated?.toISOString?.() ?? String(report.dateUpdated),
    title: report.title,
    description: report.description,
    type: report.type,
    status: report.status,
    shareLevel,
    experimentId: report.experimentId,
  };

  if (
    shareLevel === "public" &&
    report.type === "experiment-snapshot" &&
    report.uid
  ) {
    const appOrigin = (APP_ORIGIN ?? "").replace(/\/$/, "");
    base.shareUrl = `${appOrigin}/public/r/${report.uid}`;
  }

  if (report.type === "experiment-snapshot") {
    if (report.snapshot) base.snapshotId = report.snapshot;
    if (snapshot) {
      base.snapshotStatus = snapshot.status;
      base.snapshotError = snapshot.error || undefined;
    }
    const settings = report.experimentAnalysisSettings;
    if (settings) {
      base.analysisSettings = {
        statsEngine: settings.statsEngine,
        goalMetrics: settings.goalMetrics,
        secondaryMetrics: settings.secondaryMetrics,
        guardrailMetrics: settings.guardrailMetrics,
        activationMetric: settings.activationMetric || undefined,
        metricOverrides: settings.metricOverrides,
        customMetricSlices: settings.customMetricSlices,
        dimension: settings.dimension || undefined,
        differenceType: settings.differenceType,
        dateStarted:
          settings.dateStarted?.toISOString?.() ??
          (settings.dateStarted ? String(settings.dateStarted) : undefined),
        dateEnded:
          settings.dateEnded?.toISOString?.() ??
          (settings.dateEnded ? String(settings.dateEnded) : undefined),
        regressionAdjustmentEnabled: settings.regressionAdjustmentEnabled,
        sequentialTestingEnabled: settings.sequentialTestingEnabled,
        sequentialTestingTuningParameter:
          settings.sequentialTestingTuningParameter,
        attributionModel: settings.attributionModel,
        lookbackOverride: settings.lookbackOverride,
        trackingKey: settings.trackingKey || undefined,
        exposureQueryId: settings.exposureQueryId || undefined,
        segment: settings.segment || undefined,
        queryFilter: settings.queryFilter || undefined,
        skipPartialData: settings.skipPartialData,
      };
    }

    const meta = report.experimentMetadata;
    if (meta) {
      const latestPhase = meta.phases?.[meta.phases.length - 1];
      const variationWeights = latestPhase?.variationWeights ?? [];
      base.experimentMetadata = {
        type: meta.type,
        variations: meta.variations?.map((v, i) => ({
          id: v.id,
          name: v.name,
          key: v.key,
          weight: variationWeights[i] ?? 0,
        })),
        phases: meta.phases?.map((p) => ({
          name: p.name,
          dateStarted: p.dateStarted?.toISOString?.() ?? String(p.dateStarted),
          dateEnded: p.dateEnded
            ? (p.dateEnded?.toISOString?.() ?? String(p.dateEnded))
            : undefined,
          coverage: p.coverage,
        })),
      };
    }
  } else if (report.type === "experiment") {
    const args = report.args;
    if (args) {
      base.analysisSettings = {
        statsEngine: args.statsEngine,
        goalMetrics: args.goalMetrics,
        secondaryMetrics: args.secondaryMetrics,
        guardrailMetrics: args.guardrailMetrics,
        activationMetric: args.activationMetric || undefined,
        metricOverrides: args.metricOverrides,
        dimension: args.dimension || undefined,
        differenceType: args.differenceType,
        dateStarted:
          args.startDate?.toISOString?.() ??
          (args.startDate ? String(args.startDate) : undefined),
        dateEnded:
          args.endDate?.toISOString?.() ??
          (args.endDate ? String(args.endDate) : undefined),
        regressionAdjustmentEnabled: args.regressionAdjustmentEnabled,
        sequentialTestingEnabled: args.sequentialTestingEnabled,
        sequentialTestingTuningParameter: args.sequentialTestingTuningParameter,
        attributionModel: args.attributionModel,
        trackingKey: args.trackingKey || undefined,
        exposureQueryId: args.exposureQueryId || undefined,
        segment: args.segment || undefined,
        queryFilter: args.queryFilter || undefined,
        skipPartialData: args.skipPartialData,
      };
    }
  }

  return base;
}
