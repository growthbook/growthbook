import PageHead from "@/components/Layout/PageHead";
import {ExperimentSnapshotReportInterface, MetricSnapshotSettings, ReportInterface} from "back-end/types/report";
import {ExperimentSnapshotInterface} from "back-end/types/experiment-snapshot";
import Code from "@/components/SyntaxHighlighting/Code";
import {getValidDate} from "shared/dates";
import {DEFAULT_PROPER_PRIOR_STDDEV, DEFAULT_STATS_ENGINE} from "shared/constants";
import CompactResults from "@/components/Experiment/CompactResults";
import React from "react";
import Callout from "@/components/Radix/Callout";
import {getSnapshotAnalysis} from "shared/util";
import {getQueryStatus} from "@/components/Queries/RunQueriesButton";

export async function getServerSideProps(context) {
  const { r } = context.params;

  const API_HOST = (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";
  try {
    const resp = await fetch(API_HOST + `/api/report/public/${r}`);
    const data = await resp.json();
    const report = data?.report;
    if (!report) throw new Error("Report not found");

    const snapshot = data?.snapshot;
    const ssrData = data?.ssrData;

    return {
      props: {
        r,
        report,
        snapshot,
        ssrData,
      },
    };
  } catch (e) {
    console.error(e)
    return {
      notFound: true
    }
  }
}

interface ReportPageProps {
  r: string;
  report: ExperimentSnapshotReportInterface;
  snapshot?: ExperimentSnapshotInterface;
  ssrData?: Record<string, any>;
}

export default function ReportPage(props: ReportPageProps) {
  const {
    report,
    snapshot,
    ssrData
  } = props;
  const phases = report.experimentMetadata.phases;
  const phase = phases.length -1;
  const phaseObj = phases[phase];

  const variations = report.experimentMetadata.variations.map((variation, i) => ({
    id: variation.id,
    name: variation.name,
    weight: report.experimentMetadata.phases?.[snapshot?.phase || 0]?.variationWeights?.[i] || (1 / (variations?.length || 2)),
  }));
  const analysis = snapshot ? getSnapshotAnalysis(snapshot) ?? undefined : undefined;
  const queryStatusData = getQueryStatus(snapshot?.queries || [], snapshot?.error);

  const settingsForSnapshotMetrics: MetricSnapshotSettings[] =
    snapshot?.settings?.metricSettings?.map((m) => ({
      metric: m.id,
      properPrior: m.computedSettings?.properPrior ?? false,
      properPriorMean: m.computedSettings?.properPriorMean ?? 0,
      properPriorStdDev:
        m.computedSettings?.properPriorStdDev ?? DEFAULT_PROPER_PRIOR_STDDEV,
      regressionAdjustmentReason:
        m.computedSettings?.regressionAdjustmentReason || "",
      regressionAdjustmentDays:
        m.computedSettings?.regressionAdjustmentDays || 0,
      regressionAdjustmentEnabled: !!m.computedSettings
        ?.regressionAdjustmentEnabled,
      regressionAdjustmentAvailable: !!m.computedSettings
        ?.regressionAdjustmentAvailable,
    })) || [];

  return (
    <div className="pagecontents container-fluid">
      <PageHead
        breadcrumb={[
          {display: `Reports`, href: `/reports`},
          {display: report?.title ?? "(no title)"},
        ]}
      />

      <h1>{report.title}</h1>

      <div className="bg-white border">
      {!snapshot || !analysis ? (
        <Callout status="error">Missing snapshot!</Callout>
      ) : (
        <CompactResults
          variations={variations}
          multipleExposures={snapshot.multipleExposures || 0}
          results={analysis.results[0]}
          queryStatusData={queryStatusData}
          reportDate={snapshot.dateCreated}
          startDate={getValidDate(phaseObj.dateStarted).toISOString()}
          isLatestPhase={phase === phases.length - 1}
          status={"stopped"}
          goalMetrics={report.experimentAnalysisSettings.goalMetrics}
          secondaryMetrics={report.experimentAnalysisSettings.secondaryMetrics}
          guardrailMetrics={report.experimentAnalysisSettings.guardrailMetrics}
          metricOverrides={report.experimentAnalysisSettings.metricOverrides ?? []}
          id={report.id}
          statsEngine={analysis.settings.statsEngine}
          // pValueCorrection={pValueCorrection} // todo: bake this into snapshot or report
          regressionAdjustmentEnabled={report.experimentAnalysisSettings.regressionAdjustmentEnabled}
          settingsForSnapshotMetrics={settingsForSnapshotMetrics}
          sequentialTestingEnabled={analysis.settings?.sequentialTesting}
          differenceType={analysis.settings?.differenceType}
          isTabActive={true}
          experimentType={report.experimentMetadata.type}
          ssrData={ssrData}
        />
      )}
      </div>
    </div>
  );
}

ReportPage.preAuth = true;
ReportPage.progressiveAuth = true;
ReportPage.progressiveAuthTopNav = true;
ReportPage.noLoadingOverlay = true;
