import { ApiReport } from "shared/validators";
import { ReportInterface } from "shared/types/report";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";

export function toReportApiInterface(
  report: ReportInterface,
  snapshot?: ExperimentSnapshotInterface | null,
): ApiReport {
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
    experimentId: report.experimentId,
  };

  if (report.type === "experiment-snapshot") {
    base.snapshotId = report.snapshot;
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
        dateStarted:
          settings.dateStarted?.toISOString?.() ??
          (settings.dateStarted ? String(settings.dateStarted) : undefined),
        dateEnded:
          settings.dateEnded?.toISOString?.() ??
          (settings.dateEnded ? String(settings.dateEnded) : undefined),
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
        dateStarted:
          args.startDate?.toISOString?.() ??
          (args.startDate ? String(args.startDate) : undefined),
        dateEnded:
          args.endDate?.toISOString?.() ??
          (args.endDate ? String(args.endDate) : undefined),
      };
    }
  }

  return base;
}
