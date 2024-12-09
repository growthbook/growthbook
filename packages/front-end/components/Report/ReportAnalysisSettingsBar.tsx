import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import { getSnapshotAnalysis } from "shared/util";
import { ago, date, datetime } from "shared/dates";
import React, { useState } from "react";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { FaGear } from "react-icons/fa6";
import { SSRExperimentReportPolyfills } from "@/pages/r/[r]";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import DifferenceTypeChooser from "@/components/Experiment/DifferenceTypeChooser";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
import { useAuth } from "@/services/auth";
import Callout from "@/components/Radix/Callout";
import Button from "@/components/Radix/Button";

export default function ReportAnalysisSettingsBar({
  report,
  snapshot,
  mutate,
  ssrPolyfills,
  canUpdateReport = false,
  datasource,
  settingsOpen = false,
  setSettingsOpen,
}: {
  report: ExperimentSnapshotReportInterface;
  snapshot?: ExperimentSnapshotInterface;
  mutate?: () => void;
  ssrPolyfills?: SSRExperimentReportPolyfills;
  canUpdateReport?: boolean;
  datasource?: DataSourceInterfaceWithParams;
  settingsOpen?: boolean;
  setSettingsOpen?: (o: boolean) => void;
}) {
  const { apiCall } = useAuth();

  const [refreshError, setRefreshError] = useState("");
  // const { metrics: _metrics } = useDefinitions();

  // const phases = report.experimentMetadata.phases;
  // const phase = phases.length - 1;
  // const phaseObj = phases[phase];

  const variations = report.experimentMetadata.variations.map(
    (variation, i) => ({
      id: variation.id,
      name: variation.name,
      weight:
        report.experimentMetadata.phases?.[snapshot?.phase || 0]
          ?.variationWeights?.[i] || 1 / (variations?.length || 2),
    })
  );
  const analysis = snapshot
    ? getSnapshotAnalysis(snapshot) ?? undefined
    : undefined;
  const queryStatusData = getQueryStatus(
    snapshot?.queries || [],
    snapshot?.error
  );

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  if (!snapshot) return null;

  return (
    <div className="py-2 mb-2">
      <div className="row align-items-center px-3">
        <div className="col-auto d-flex align-items-end mr-3">
          <DimensionChooser
            value={snapshot.dimension ?? ""}
            activationMetric={!!snapshot.settings.activationMetric}
            datasourceId={snapshot.settings.datasourceId}
            exposureQueryId={snapshot.settings.exposureQueryId}
            userIdType={report?.experimentAnalysisSettings?.userIdType}
            labelClassName="mr-2"
            disabled={true}
            ssrPolyfills={ssrPolyfills}
          />
        </div>
        <div className="col-auto d-flex align-items-end mr-3">
          <DifferenceTypeChooser
            differenceType={
              report?.experimentAnalysisSettings?.differenceType ?? "relative"
            }
            // ensure disabled is true to style correctly
            // and callbacks are not needed
            disabled={true}
            phase={0}
            setDifferenceType={() => {}}
            setAnalysisSettings={() => {}}
            mutate={() => {}}
          />
        </div>
        <div className="col-auto d-flex align-items-end mr-3">
          <div>
            <div className="uppercase-title text-muted">Date range</div>
            <div className="relative">
              <span className="date-label">
                {date(snapshot.settings.startDate)} —{" "}
                {snapshot.settings.endDate
                  ? date(snapshot.settings.endDate)
                  : "now"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex-1" />
        <div className="col-auto">
          {hasData && snapshot.runStarted ? (
            <div
              className="text-muted text-right"
              style={{ width: 110, fontSize: "0.8em" }}
              title={datetime(snapshot.runStarted)}
            >
              <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
                updated
              </div>
              <div className="d-inline-block" style={{ lineHeight: 1 }}>
                {ago(snapshot.runStarted)}
              </div>
            </div>
          ) : (
            ""
          )}
        </div>
        {canUpdateReport && mutate ? (
          <div className="col-auto">
            <RunQueriesButton
              icon="refresh"
              cta="Refresh"
              mutate={mutate}
              model={snapshot}
              cancelEndpoint={`/report/${report.id}/cancel`}
              color="outline-primary"
              disabled={settingsOpen}
              useRadixButton={true}
              onSubmit={async () => {
                try {
                  await apiCall<{
                    report: ExperimentSnapshotReportInterface;
                  }>(`/report/${report.id}/refresh`, {
                    method: "POST",
                  });
                  mutate();
                  setRefreshError("");
                } catch (e) {
                  setRefreshError(e.message);
                }
              }}
            />
          </div>
        ) : null}
        {canUpdateReport && setSettingsOpen ? (
          <div className="col-auto">
            <Button
              type="button"
              variant={settingsOpen ? "solid" : "outline"}
              size="sm"
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              <FaGear size={14} />
            </Button>
          </div>
        ) : null}
        {canUpdateReport && datasource && mutate ? (
          <div className="col-auto">
            <ResultMoreMenu
              snapshotId={snapshot?.id || ""}
              datasource={datasource}
              hasData={hasData}
              forceRefresh={async () => {
                try {
                  // const res = await apiCall<{ report: ReportInterface }>(
                  //   `/report/${report.id}/refresh?force=true`,
                  //   {
                  //     method: "POST",
                  //   }
                  // );
                  // mutate();
                } catch (e) {
                  console.error(e);
                }
              }}
              supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
              // editMetrics={
              //   canUpdateReport
              //     ? () => setActive("Configuration")
              //     : undefined
              // }
              generateReport={false}
              notebookUrl={`/report/${report.id}/notebook`}
              notebookFilename={report.title}
              queries={snapshot.queries}
              queryError={snapshot.error}
              results={analysis?.results}
              variations={variations}
              metrics={getAllMetricIdsFromExperiment(snapshot.settings, false)}
              trackingKey={report.title}
              dimension={snapshot.dimension ?? undefined}
              // project={experimentData?.experiment.project || ""}
            />
          </div>
        ) : null}
      </div>
      {/*{report.error ? (*/}
      {/*  <div className="alert alert-danger">*/}
      {/*    <strong>Error generating the report: </strong> {report.error}*/}
      {/*  </div>*/}
      {/*) : null}*/}
      {refreshError && (
        <Callout status="error" size="sm" mt="2" mx="4">
          <strong>Error refreshing data:</strong> {refreshError}
        </Callout>
      )}
      {/*{!hasMetrics && (*/}
      {/*  <div className="alert alert-info">*/}
      {/*    Add at least 1 metric to view results.*/}
      {/*  </div>*/}
      {/*)}*/}
      {/*{!hasData &&*/}
      {/*  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.*/}
      {/*  !report.results.unknownVariations?.length &&*/}
      {/*  queryStatusData.status !== "running" &&*/}
      {/*  hasMetrics && (*/}
      {/*    <div className="alert alert-info">*/}
      {/*      No data yet.{" "}*/}
      {/*      {report.results &&*/}
      {/*        phaseAgeMinutes >= 120 &&*/}
      {/*        "Make sure your experiment is tracking properly."}*/}
      {/*      {report.results &&*/}
      {/*        phaseAgeMinutes < 120 &&*/}
      {/*        "It was just started " +*/}
      {/*        ago(report.args.startDate) +*/}
      {/*        ". Give it a little longer and click the 'Refresh' button to check again."}*/}
      {/*      {!report.results &&*/}
      {/*        canUpdateReport &&*/}
      {/*        `Click the "Refresh" button.`}*/}
      {/*    </div>*/}
      {/*  )}*/}
    </div>
  );
}
