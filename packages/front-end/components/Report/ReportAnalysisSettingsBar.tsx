import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import { getSnapshotAnalysis } from "shared/util";
import { ago, date, datetime, getValidDate } from "shared/dates";
import React, { RefObject, useEffect, useState } from "react";
import { FaChartBar } from "react-icons/fa";
import { PiEye } from "react-icons/pi";
import { SSRExperimentReportPolyfills } from "@/pages/r/[r]";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import DifferenceTypeChooser from "@/components/Experiment/DifferenceTypeChooser";
import { useAuth } from "@/services/auth";
import Callout from "@/components/Radix/Callout";
import Button from "@/components/Radix/Button";
import { DropdownMenu } from "@/components/Radix/DropdownMenu";
import Metadata from "@/components/Radix/Metadata";

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
  ssrPolyfills?: SSRExperimentReportPolyfills;
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
      <div className="pt-1 pb-2 border-bottom">
        <div className="row align-items-center px-3">
          <div className="col-auto d-flex align-items-center mr-3">
            <div className="h5 my-0 mr-4">
              <FaChartBar className="mr-2" />
              Results
            </div>
          </div>
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
          <div className="col-auto d-flex mr-3">
            <DropdownMenu
              trigger={
                <Button variant="ghost" size="sm">
                  <PiEye className="mr-1" />
                  More...
                </Button>
              }
              menuPlacement="center"
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
                    report?.experimentAnalysisSettings
                      ?.regressionAdjustmentEnabled
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
                <div className="text-right mt-3">
                  <Metadata
                    label="Run date"
                    value={getValidDate(snapshot.runStarted).toLocaleString(
                      [],
                      {
                        year: "numeric",
                        month: "numeric",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }
                    )}
                  />
                </div>
              </div>
            </DropdownMenu>
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
          {canUpdateReport && mutateReport && mutateSnapshot ? (
            <div className="col-auto">
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
            <div className="col-auto d-flex">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditAnalysisOpen(true)}
              >
                Edit Analysis
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {refreshError && (
        <Callout status="error" size="sm" my="2" mx="4">
          <strong>Error refreshing data:</strong> {refreshError}
        </Callout>
      )}
      {!hasMetrics && (
        <Callout status="info" size="sm" my="2" mx="4">
          Add at least 1 metric to view results.
        </Callout>
      )}
    </>
  );
}
