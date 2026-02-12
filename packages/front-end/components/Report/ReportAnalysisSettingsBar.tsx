import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentSnapshotReportInterface } from "shared/types/report";
import { getSnapshotAnalysis } from "shared/util";
import { ago, date, datetime, getValidDate } from "shared/dates";
import React, { RefObject, useEffect, useMemo, useState } from "react";
import { PiEye } from "react-icons/pi";
import { Box } from "@radix-ui/themes";
import { startCase } from "lodash";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import DifferenceTypeChooser from "@/components/Experiment/DifferenceTypeChooser";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { DropdownMenu } from "@/ui/DropdownMenu";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import { useDefinitions } from "@/services/DefinitionsContext";

const numberFormatter = Intl.NumberFormat();

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

  const analysis = snapshot
    ? (getSnapshotAnalysis(snapshot) ?? undefined)
    : undefined;

  const { getDatasourceById } = useDefinitions();

  const datasourceSettings = report.experimentAnalysisSettings.datasource
    ? getDatasourceById(report.experimentAnalysisSettings.datasource)?.settings
    : undefined;

  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === report.experimentAnalysisSettings.exposureQueryId,
  )?.userIdType;

  const totalUnits = useMemo(() => {
    const healthVariationUnits =
      snapshot?.health?.traffic?.overall?.variationUnits;
    if (healthVariationUnits && healthVariationUnits.length > 0) {
      return healthVariationUnits.reduce((acc, a) => acc + a, 0);
    }
    // Fallback to using results for total units if health units not available
    let totalUsers = 0;
    analysis?.results?.forEach((result) => {
      result?.variations?.forEach((v) => (totalUsers += v?.users || 0));
    });
    return totalUsers;
  }, [analysis?.results, snapshot?.health?.traffic?.overall?.variationUnits]);

  // Convert userIdType to display name (e.g. "user_id" -> "User Ids")
  const unitDisplayName = userIdType
    ? startCase(userIdType.split("_").join(" ")) + "s"
    : "Units";

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
                analysis?.settings?.statsEngine === "frequentist"
                  ? "Frequentist"
                  : "Bayesian"
              }
            />
            <Metadata
              label="CUPED"
              value={
                analysis?.settings?.regressionAdjusted ? "Enabled" : "Disabled"
              }
            />
            {analysis?.settings?.statsEngine === "frequentist" && (
              <Metadata
                label="Sequential"
                value={
                  analysis?.settings?.sequentialTesting ? "Enabled" : "Disabled"
                }
              />
            )}
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
        <div className="row flex-grow-1 flex-shrink-0 pt-1 px-2 justify-content-end align-items-center">
          <div className="col-auto mr-2" style={{ fontSize: "12px" }}>
            <Metadata
              label={unitDisplayName}
              value={numberFormatter.format(totalUnits ?? 0)}
            />
          </div>
          <div className="col-auto px-0">
            {hasData && snapshot.runStarted ? (
              <Box style={{ lineHeight: 1.2, fontSize: "12px" }}>
                <Text weight="medium" color="text-mid">
                  Updated {ago(snapshot.runStarted ?? "")}
                </Text>
              </Box>
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
                radixVariant="soft"
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
