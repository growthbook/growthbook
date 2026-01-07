import React, { FC, useState } from "react";
import dynamic from "next/dynamic";
import { Box } from "@radix-ui/themes";
import { getValidDate, ago, relativeDate } from "shared/dates";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  SAFE_ROLLOUT_VARIATIONS,
} from "shared/constants";
import { MetricSnapshotSettings } from "shared/types/report";
import { SafeRolloutInterface } from "shared/validators";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import { PiWarningFill } from "react-icons/pi";
import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import Link from "@/ui/Link";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import MultipleExposuresCard from "../HealthTab/MultipleExposuresCard";
import SRMCard from "../HealthTab/SRMCard";
import { useSafeRolloutSnapshot } from "./SnapshotProvider";
import SafeRolloutAnalysisSettingsSummary from "./AnalysisSettingsSummary";

const CompactResults = dynamic(
  () => import("@/components/SafeRollout/Results/CompactResults"),
);

const WarningIcon = () => (
  <PiWarningFill style={{ color: "var(--amber-11)" }} />
);

const SafeRolloutResults: FC<{
  safeRollout: SafeRolloutInterface;
  draftMode?: boolean;
}> = ({ safeRollout, draftMode = false }) => {
  // todo: move to snapshot property
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  const {
    error,
    snapshot,
    latest,
    analysis,
    loading: snapshotLoading,
  } = useSafeRolloutSnapshot();

  const queryStatusData = getQueryStatus(latest?.queries || [], latest?.error);

  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const { hasCommercialFeature, organization } = useUser();
  const settings = organization?.settings;

  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  const phaseAgeMinutes =
    (Date.now() - getValidDate(safeRollout.startedAt ?? "").getTime()) /
    (1000 * 60);

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
      regressionAdjustmentEnabled:
        !!m.computedSettings?.regressionAdjustmentEnabled,
      regressionAdjustmentAvailable:
        !!m.computedSettings?.regressionAdjustmentAvailable,
    })) || [];

  const showCompactResults = !draftMode && hasData && snapshot && analysis;

  const datasource = getDatasourceById(safeRollout.datasourceId);

  const exposureQuery = datasource?.settings.queries?.exposure?.find(
    (e) => e.id === safeRollout.exposureQueryId,
  );

  const totalUsers = snapshot?.health?.traffic?.overall?.variationUnits?.reduce(
    (acc, a) => acc + a,
    0,
  );

  const traffic = snapshot?.health?.traffic;

  const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(false);
  const [isHealthExpanded, setIsHealthExpanded] = useState(false);

  const resultsStatus = safeRollout.analysisSummary?.resultsStatus;
  const showGuardrailWarning = Object.values(
    resultsStatus?.variations[0].guardrailMetrics ?? {},
  )?.some((metric) => metric.status === "lost");

  const daysLeft = getSafeRolloutDaysLeft({
    safeRollout,
    snapshotWithResults: snapshot,
  });

  const decisionStatus = getSafeRolloutResultStatus({
    safeRollout,
    healthSettings: getHealthSettings(
      settings,
      hasCommercialFeature("decision-framework"),
    ),
    daysLeft,
  });
  const showHealthWarning = decisionStatus?.status === "unhealthy";

  if (error) {
    return (
      <Callout status="error" mx="3" my="4">
        {error.message}
      </Callout>
    );
  }

  const hasMetrics = safeRollout?.guardrailMetricIds?.length > 0;

  return (
    <Box>
      <Link
        weight="medium"
        onClick={() => setIsAnalysisExpanded(!isAnalysisExpanded)}
      >
        {isAnalysisExpanded ? <FaCaretDown /> : <FaCaretRight />} View Results{" "}
        {(showHealthWarning || showGuardrailWarning) && <WarningIcon />}
      </Link>

      {isAnalysisExpanded ? (
        <>
          <Box
            mt="3"
            style={{
              border: "1px solid var(--slate-a4)",
              borderRadius: "var(--radius-2)",
            }}
          >
            <SafeRolloutAnalysisSettingsSummary safeRollout={safeRollout} />

            {!hasData &&
              status !== "running" &&
              hasMetrics &&
              !snapshotLoading && (
                <Callout status="info" mx="3" my="4">
                  No data yet.{" "}
                  {snapshot &&
                    phaseAgeMinutes >= 120 &&
                    "Make sure your safe rollout is tracking properly."}
                  {snapshot &&
                    phaseAgeMinutes < 120 &&
                    (phaseAgeMinutes < 0
                      ? "This safe rollout will start " +
                        relativeDate(safeRollout.startedAt ?? "") +
                        ". Wait until it's been running for a little while and click the 'Update' button above to check again."
                      : "It was just started " +
                        ago(safeRollout.startedAt ?? "") +
                        ". Give it a little longer and click the 'Update' button above to check again.")}
                  {!snapshot &&
                    datasource &&
                    permissionsUtil.canRunExperimentQueries(datasource) &&
                    `Click the "Update" button above.`}
                  {snapshotLoading && <div> Snapshot loading...</div>}
                </Callout>
              )}

            {showCompactResults ? (
              <CompactResults
                variations={SAFE_ROLLOUT_VARIATIONS}
                results={analysis.results[0]}
                queryStatusData={queryStatusData}
                reportDate={snapshot.dateCreated}
                startDate={getValidDate(safeRollout.startedAt).toDateString()}
                isLatestPhase={true}
                status={
                  safeRollout.status === "running" ? "running" : "stopped"
                }
                goalMetrics={[]}
                guardrailMetrics={safeRollout.guardrailMetricIds}
                metricOverrides={[]}
                id={safeRollout.id}
                statsEngine={"frequentist"}
                pValueCorrection={pValueCorrection}
                regressionAdjustmentEnabled={
                  analysis.settings?.regressionAdjusted
                }
                settingsForSnapshotMetrics={settingsForSnapshotMetrics}
                experimentType={"standard"}
              />
            ) : null}
          </Box>
          {snapshot && (
            <>
              <Link
                weight="medium"
                mt="5"
                onClick={() => setIsHealthExpanded(!isHealthExpanded)}
              >
                {isHealthExpanded ? <FaCaretDown /> : <FaCaretRight />}
                View Traffic {showHealthWarning && <WarningIcon />}
              </Link>

              {isHealthExpanded ? (
                traffic && totalUsers ? (
                  <>
                    <SRMCard
                      newDesign={true}
                      traffic={traffic}
                      variations={SAFE_ROLLOUT_VARIATIONS}
                      totalUsers={totalUsers}
                      dataSource={datasource}
                      exposureQuery={exposureQuery}
                      canConfigHealthTab={false}
                      hideDimensions
                    />
                    <Box mt="4">
                      <MultipleExposuresCard
                        totalUsers={totalUsers}
                        snapshot={snapshot}
                      />
                    </Box>
                  </>
                ) : traffic ? (
                  <Callout status="info" mt="3">
                    No data yet.
                  </Callout>
                ) : (
                  <Callout status="info" mt="3">
                    Please run a query to see health data.
                  </Callout>
                )
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Box>
  );
};

export default SafeRolloutResults;
