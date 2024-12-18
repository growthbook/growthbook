import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import { getSnapshotAnalysis } from "shared/util";
import { ago, date, datetime, getValidDate } from "shared/dates";
import React, { RefObject, useEffect, useState } from "react";
import { PiEye } from "react-icons/pi";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import DifferenceTypeChooser from "@/components/Experiment/DifferenceTypeChooser";
import { useAuth } from "@/services/auth";
import Callout from "@/components/Radix/Callout";
import Button from "@/components/Radix/Button";
import { DropdownMenu } from "@/components/Radix/DropdownMenu";
import Metadata from "@/components/Radix/Metadata";
import Link from "@/components/Radix/Link";

export default function ReportAnalysisSettingsBar({
  report,
  snapshot: _snapshot,
  mutateReport,
  mutateSnapshot,
  ssrPolyfills,
  canUpdateReport = false,
  setEditAnalysisOpen,
  runQueriesButtonRef,
}: {
  report: ExperimentSnapshotReportInterface;
  snapshot?: ExperimentSnapshotInterface;
  mutateReport?: () => Promise<unknown> | unknown;
  mutateSnapshot?: () => Promise<unknown> | unknown;
  ssrPolyfills?: SSRPolyfills;
  canUpdateReport?: boolean;
  setEditAnalysisOpen?: (o: boolean) => void;
  runQueriesButtonRef?: RefObject<HTMLButtonElement>;
}) {
  const { apiCall } = useAuth();

  const [refreshError, setRefreshError] = useState("");
  const [snapshot, setSnapshot] = useState<
    ExperimentSnapshotInterface | undefined
  >(_snapshot);
  useEffect(() => {
    if (
      _snapshot &&
      (!snapshot ||
        getValidDate(_snapshot?.runStarted) >
          getValidDate(snapshot?.runStarted))
    ) {
      setSnapshot(_snapshot);
    }
  }, [_snapshot, snapshot]);

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

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const hasMetrics =
    report.experimentAnalysisSettings.goalMetrics.length > 0 ||
    report.experimentAnalysisSettings.secondaryMetrics.length > 0 ||
    report.experimentAnalysisSettings.guardrailMetrics.length > 0;

  if (!snapshot) return null;

  return (
    <>
      <div className="mb-1 d-flex align-items-center justify-content-between">
        <div className="h3 mb-1">Analysis</div>
        <DropdownMenu
          trigger={
            <Link>
              <PiEye className="mr-1" />
              View details
            </Link>
          }
          menuPlacement="end"
        >
          <div style={{ minWidth: 250 }} className="p-2">
            <h5>Results computed with:</h5>
            <Metadata
              label="Engine"
              value={
                report?.experimentAnalysisSettings?.statsEngine ===
                "frequentist"
                  ? "Frequentist"
                  : "Bayesian"
              }
            />
            <Metadata
              label="CUPED"
              value={
                report?.experimentAnalysisSettings?.regressionAdjustmentEnabled
                  ? "Enabled"
                  : "Disabled"
              }
            />
            <Metadata
              label="Sequential"
              value={
                report?.experimentAnalysisSettings?.sequentialTestingEnabled
                  ? "Enabled"
                  : "Disabled"
              }
            />
            {snapshot.runStarted && (
              <div className="text-right mt-3">
                <Metadata
                  label="Run date"
                  value={datetime(snapshot.runStarted)}
                />
              </div>
            )}
          </div>
        </DropdownMenu>
      </div>
      <div className="py-1 d-flex mb-2">
        <div className="row align-items-center" style={{ gap: "0.5rem 1rem" }}>
          <div className="col-auto d-flex align-items-end">
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
          <div className="col-auto d-flex align-items-end">
            <DifferenceTypeChooser
              differenceType={
                report?.experimentAnalysisSettings?.differenceType ?? "relative"
              }
              disabled={true}
              phase={0}
              setDifferenceType={() => {}}
              setAnalysisSettings={() => {}}
              mutate={() => {}}
            />
          </div>
          <div className="col-auto d-flex align-items-end">
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
        </div>
        <div className="row flex-grow-1 flex-shrink-0 pt-1 px-2 justify-content-end">
          <div className="col-auto px-0">
            {hasData && snapshot.runStarted ? (
              <div
                className="text-muted text-right"
                style={{ width: 130, fontSize: "0.8em" }}
                title={datetime(snapshot.runStarted)}
              >
                <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
                  last updated
                </div>
                <div className="d-inline-block" style={{ lineHeight: 1 }}>
                  {ago(snapshot.runStarted)}
                </div>
              </div>
            ) : null}
          </div>
          {canUpdateReport && mutateReport && mutateSnapshot ? (
            <div className="col-auto pr-0">
              <RunQueriesButton
                ref={runQueriesButtonRef}
                icon="refresh"
                cta="Refresh"
                mutate={async () => {
                  await mutateReport();
                  await mutateSnapshot();
                }}
                model={snapshot}
                cancelEndpoint={`/report/${report.id}/cancel`}
                color="outline-primary"
                useRadixButton={true}
                onSubmit={async () => {
                  try {
                    const res = await apiCall<{
                      snapshot: ExperimentSnapshotInterface;
                    }>(`/report/${report.id}/refresh`, {
                      method: "POST",
                    });
                    if (res.snapshot) {
                      setSnapshot(res.snapshot);
                    }
                    setRefreshError("");
                  } catch (e) {
                    setRefreshError(e.message);
                  }
                }}
              />
            </div>
          ) : null}
          {canUpdateReport && setEditAnalysisOpen ? (
            <div className="col-auto d-flex pr-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                ml="2"
                onClick={() => setEditAnalysisOpen(true)}
              >
                Edit Analysis
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {refreshError && (
        <Callout status="error" size="sm" mb="4">
          <strong>Error refreshing data:</strong> {refreshError}
        </Callout>
      )}
      {!hasMetrics && (
        <Callout status="info" size="sm" mb="4">
          Add at least 1 metric to view results.
        </Callout>
      )}
    </>
  );
}
