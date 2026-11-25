import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { resolveAnalysisIdentifierType } from "shared/util";
import { FactTableColumnType } from "shared/types/fact-table";
import { getScopedSettings } from "shared/settings";
import {
  isDimensionPrecomputed,
  getEffectiveLookbackOverride,
  getComputableNewMetricIds,
} from "shared/experiments";
import React, { useState, useCallback, useMemo } from "react";
import {
  ExperimentSnapshotReportArgs,
  ReportInterface,
} from "shared/types/report";
import { useRouter } from "next/router";
import { Trans, useLingui } from "@lingui/react/macro";

import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { Box, Flex, Text } from "@radix-ui/themes";
import { date } from "shared/dates";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Results, { AnalysisBarSettings } from "@/components/Experiment/Results";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import ExperimentReportsList from "@/components/Experiment/ExperimentReportsList";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import {
  getHonoredPrecomputedUnitDimensionIds,
  getNewMetricRowStates,
} from "@/services/experiments";
import track from "@/services/track";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import AnalysisSettingInfo from "@/components/AnalysisSettingInfo";
import AnalysisSettingsSummary from "./AnalysisSettingsSummary";
import { ExperimentTab } from ".";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editMetrics?: (() => void) | null;
  holdoutProjects?: string[];
  envs: string[];
  setTab: (tab: ExperimentTab) => void;
  isTabActive: boolean;
  metricTagFilter: string[];
  setMetricTagFilter: (tags: string[]) => void;
  metricsFilter: string[];
  setMetricsFilter: (filters: string[]) => void;
  availableMetricsFilters: {
    groups: Array<{ id: string; name: string }>;
    metrics: Array<{ id: string; name: string }>;
  };
  availableMetricTags: string[];
  availableSliceTags: Array<{
    id: string;
    datatypes: Record<string, FactTableColumnType>;
    isSelectAll?: boolean;
  }>;
  sliceTagsFilter: string[];
  setSliceTagsFilter: (tags: string[]) => void;
  analysisBarSettings: AnalysisBarSettings;
  setAnalysisBarSettings: (
    s:
      | AnalysisBarSettings
      | ((prev: AnalysisBarSettings) => AnalysisBarSettings),
  ) => void;
  sortBy: "significance" | "change" | null;
  setSortBy: (s: "significance" | "change" | null) => void;
  sortDirection: "asc" | "desc" | null;
  setSortDirection: (d: "asc" | "desc" | null) => void;
}

export default function ResultsTab({
  experiment,
  envs,
  mutate,
  editMetrics,
  setTab,
  isTabActive,
  analysisBarSettings,
  setAnalysisBarSettings,
  metricTagFilter,
  setMetricTagFilter,
  metricsFilter,
  setMetricsFilter,
  availableMetricsFilters,
  availableMetricTags,
  availableSliceTags,
  sliceTagsFilter,
  setSliceTagsFilter,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  holdoutProjects,
}: Props) {
  const { t } = useLingui();
  const {
    getDatasourceById,
    getExperimentMetricById,
    getProjectById,
    datasources,
    getSegmentById,
    getFactTableById,
    metricGroups,
  } = useDefinitions();

  const { apiCall } = useAuth();

  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false);

  const router = useRouter();

  const {
    snapshot,
    analysis,
    latestSummary,
    phase,
    setSnapshotType,
    setAnalysisSettings,
  } = useSnapshot();

  const permissionsUtil = usePermissionsUtil();
  const { organization, hasCommercialFeature } = useUser();
  const project = getProjectById(experiment.project || "");
  const isDemoExperiment =
    !!experiment.project &&
    experiment.project ===
      getDemoDatasourceProjectIdForOrganization(organization.id);
  const honoredPrecomputedUnitDimensionIds =
    getHonoredPrecomputedUnitDimensionIds(
      experiment.precomputedUnitDimensionIds,
      experiment.datasource
        ? getDatasourceById(experiment.datasource)
        : undefined,
      hasCommercialFeature("pipeline-mode"),
    );

  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    experiment: experiment,
  });

  const statsEngine = scopedSettings.statsEngine.value;

  const segment = getSegmentById(experiment.segment || "");

  const activationMetric = getExperimentMetricById(
    experiment.activationMetric || "",
  );

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const hasValidStatsEngine =
    !analysis?.settings ||
    (analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE) === statsEngine;

  const hasResults =
    experiment.status !== "draft" &&
    hasData &&
    hasValidStatsEngine &&
    snapshot &&
    analysis?.results?.[0];

  const isBandit = experiment.type === "multi-armed-bandit";

  const datasourceSettings = experiment.datasource
    ? getDatasourceById(experiment.datasource)?.settings
    : undefined;
  const userIdType = resolveAnalysisIdentifierType(
    datasourceSettings?.queries?.exposure?.find(
      (e) => e.id === experiment.exposureQueryId,
    ),
    experiment.exposureQueryIdentifierType,
  );
  const isLatestPhase = phase === experiment.phases.length - 1;
  const showsMetricRows = !analysis?.settings?.dimensions?.length;
  const newMetricIds = useMemo(
    () =>
      snapshot
        ? getComputableNewMetricIds({
            experiment,
            snapshotSettings: snapshot.settings,
            metricGroups,
            getMetricById: getExperimentMetricById,
            getFactTableById,
            identifierType: userIdType,
            datasourceSettings,
          })
        : [],
    [
      experiment,
      snapshot,
      metricGroups,
      getExperimentMetricById,
      getFactTableById,
      userIdType,
      datasourceSettings,
    ],
  );
  const newMetricStates = useMemo(
    () =>
      isLatestPhase && showsMetricRows
        ? getNewMetricRowStates({
            newMetricIds,
            latest: latestSummary ?? null,
          })
        : undefined,
    [newMetricIds, isLatestPhase, showsMetricRows, latestSummary],
  );

  const reportArgs: ExperimentSnapshotReportArgs = {
    userIdType: userIdType as "user" | "anonymous" | undefined,
    differenceType: analysisBarSettings.differenceType,
    dimension: analysisBarSettings.dimension,
  };

  const onSnapshotSuccessfulUpdate = useCallback(() => {
    // Reset analysis settings to default
    setAnalysisSettings(null);
    setAnalysisBarSettings((prev) => ({
      ...prev,
      dimension: isDimensionPrecomputed(
        prev.dimension,
        honoredPrecomputedUnitDimensionIds,
      )
        ? ""
        : prev.dimension,
      baselineRow: 0,
      variationFilter: [],
      differenceType: "relative",
    }));
  }, [
    setAnalysisBarSettings,
    setAnalysisSettings,
    honoredPrecomputedUnitDimensionIds,
  ]);

  const endDate =
    experiment.status !== "running" ? snapshot?.settings?.endDate : undefined;

  const engineIsBayesian =
    (analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE) !== "frequentist";
  const anyMetricUsesProperPrior =
    snapshot?.settings?.metricSettings?.some(
      (m) => m.computedSettings?.properPrior,
    ) ?? false;
  const priorUsed = hasData && engineIsBayesian && anyMetricUsesProperPrior;
  const cupedUsed = hasData && !!analysis?.settings?.regressionAdjusted;
  const postStratificationUsed =
    hasData &&
    !!analysis?.settings?.postStratificationEnabled &&
    !organization?.settings?.disablePrecomputedDimensions;

  return (
    <div>
      {isBandit && hasResults ? (
        <Callout status="info" mb="5">
          <Trans>
            Bandits are better than experiments at directing traffic to the best
            variation but they can produce biased results.
          </Trans>
        </Callout>
      ) : null}

      <Box>
        <Flex direction="row" align="start" gap="3" mx="1" mb="4">
          {!(
            experiment.type === "multi-armed-bandit" &&
            experiment.status === "running"
          ) && permissionsUtil.canUpdateExperiment(experiment, {}) ? (
            <Link
              type="button"
              onClick={() => setAnalysisSettingsOpen(true)}
              mr="2"
            >
              <Trans>Edit Settings</Trans>
            </Link>
          ) : null}
          {hasData && (
            <>
              <Flex align="center" gap="1">
                <Metadata
                  label={t`Engine`}
                  value={
                    analysis?.settings?.statsEngine === "frequentist"
                      ? t`Frequentist`
                      : t`Bayesian`
                  }
                />
                {priorUsed ? (
                  <AnalysisSettingInfo
                    drilldownHint
                    ariaLabel={t`How a Bayesian prior affects results`}
                    description={t`A Bayesian prior shrinks the metric estimate towards the prior mean.`}
                  />
                ) : null}
              </Flex>
              <Flex align="center" gap="1">
                <Metadata
                  label="CUPED"
                  value={
                    analysis?.settings?.regressionAdjusted
                      ? t`Enabled`
                      : t`Disabled`
                  }
                />
                {cupedUsed ? (
                  <AnalysisSettingInfo
                    drilldownHint
                    ariaLabel={t`How CUPED affects results`}
                    description={t`CUPED adjusts for pre-exposure mean imbalances across variations to reduce variance.`}
                  />
                ) : null}
              </Flex>
              {!organization?.settings?.disablePrecomputedDimensions ? (
                <Flex align="center" gap="1">
                  <Metadata
                    label={t`Post-Stratification`}
                    value={
                      analysis?.settings?.postStratificationEnabled
                        ? t`Enabled`
                        : t`Disabled`
                    }
                  />
                  {postStratificationUsed ? (
                    <AnalysisSettingInfo
                      drilldownHint
                      ariaLabel={t`How post-stratification affects results`}
                      description={t`Post-stratification adjusts for within-dimension imbalances to reduce variance.`}
                    />
                  ) : null}
                </Flex>
              ) : null}
              {analysis?.settings?.statsEngine === "frequentist" ? (
                <Metadata
                  label={t`Sequential`}
                  value={
                    analysis?.settings?.sequentialTesting
                      ? t`Enabled`
                      : t`Disabled`
                  }
                />
              ) : null}
              {segment ? (
                <Metadata label={t`Segment`} value={segment.name} />
              ) : null}
              {activationMetric ? (
                <Metadata
                  label={t`Activation Metric`}
                  value={activationMetric.name}
                />
              ) : null}
              {getEffectiveLookbackOverride(
                experiment.attributionModel,
                experiment.lookbackOverride,
              ) && experiment.lookbackOverride ? (
                <Metadata
                  label={t`Lookback Enforced`}
                  value={
                    experiment.lookbackOverride.type === "date"
                      ? `${date(experiment.lookbackOverride.value, "UTC")} - ${endDate ? date(endDate, "UTC") : t`now`}`
                      : `${experiment.lookbackOverride.value} ${experiment.lookbackOverride.valueUnit}`
                  }
                />
              ) : null}
              {isBandit && snapshot ? (
                <>
                  <Flex style={{ flex: 1 }} />
                  <Flex direction="column" align="end">
                    <Metadata
                      label={t`Analysis type`}
                      value={
                        snapshot?.type === "exploratory" ? (
                          <Tooltip
                            body={
                              <div className="text-left">
                                <p>
                                  <Trans>
                                    This is an exploratory analysis.
                                  </Trans>
                                </p>
                                <p>
                                  <Trans>
                                    Exploratory analyses do not cause bandit
                                    variation weights to change.
                                  </Trans>
                                </p>
                              </div>
                            }
                          >
                            <Trans>Exploratory</Trans>
                          </Tooltip>
                        ) : snapshot?.type === "standard" ? (
                          <Tooltip
                            body={
                              <div className="text-left">
                                <p>
                                  <Trans>This is a standard analysis.</Trans>
                                </p>
                                <p>
                                  <Trans>
                                    Bandit variation weights may have changed in
                                    response to this analysis.
                                  </Trans>
                                </p>
                              </div>
                            }
                          >
                            <Trans>Standard</Trans>
                          </Tooltip>
                        ) : (
                          <span>{snapshot?.type || t`unknown`}</span>
                        )
                      }
                    />
                    {snapshot?.type !== "standard" && (
                      <Link
                        onClick={() => setSnapshotType("standard")}
                        style={{ marginBottom: -8 }}
                      >
                        <Text size="1">
                          <Trans>View standard analysis</Trans>
                        </Text>
                      </Link>
                    )}
                  </Flex>
                </>
              ) : null}
            </>
          )}
        </Flex>
      </Box>

      <div className="appbox">
        {analysisSettingsOpen ? (
          <AnalysisForm
            cancel={() => setAnalysisSettingsOpen(false)}
            experiment={experiment}
            envs={envs}
            mutate={mutate}
            phase={experiment.phases.length - 1}
            editDates={false}
            editMetrics={true}
            editVariationIds={false}
            source={"results-tab"}
            holdoutProjects={holdoutProjects}
          />
        ) : null}
        <div style={{ overflowX: "initial" }}>
          <AnalysisSettingsSummary
            experiment={experiment}
            newMetricIds={newMetricIds}
            mutate={mutate}
            statsEngine={statsEngine}
            editMetrics={editMetrics ?? undefined}
            variationFilter={analysisBarSettings.variationFilter}
            baselineRow={analysisBarSettings.baselineRow}
            differenceType={analysisBarSettings.differenceType}
            dimension={analysisBarSettings.dimension}
            setDimension={(d: string, resetOtherSettings?: boolean) =>
              setAnalysisBarSettings({
                ...analysisBarSettings,
                dimension: d,
                ...(resetOtherSettings
                  ? {
                      baselineRow: 0,
                      differenceType: "relative",
                      variationFilter: [],
                    }
                  : {}),
              })
            }
            metricTagFilter={metricTagFilter}
            setMetricTagFilter={setMetricTagFilter}
            metricsFilter={metricsFilter}
            setMetricsFilter={setMetricsFilter}
            availableMetricsFilters={availableMetricsFilters}
            availableMetricTags={availableMetricTags}
            availableSliceTags={availableSliceTags}
            sliceTagsFilter={sliceTagsFilter}
            setSliceTagsFilter={setSliceTagsFilter}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSnapshotSuccessfulUpdate={onSnapshotSuccessfulUpdate}
          />
          {experiment.status === "draft" ? (
            <Callout status="info" contentAlign="center" mx="3" my="3">
              <Trans>
                This experiment is still a draft. Start it to see results.
              </Trans>
            </Callout>
          ) : (
            <>
              {experiment.status === "running" &&
              !experiment.datasource &&
              !snapshot &&
              !experiment.id.match(/^exp_sample/) ? (
                <Callout
                  status="info"
                  contentAlign="center"
                  mx="3"
                  my="3"
                  action={
                    datasources.length > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAnalysisSettingsOpen(true)}
                      >
                        <Trans>Select Data Source</Trans>
                      </Button>
                    ) : (
                      <LinkButton
                        href="/datasources"
                        variant="outline"
                        size="sm"
                      >
                        <Trans>Connect a Data Source</Trans>
                      </LinkButton>
                    )
                  }
                >
                  {datasources.length > 0
                    ? t`Select a Data Source and metrics so GrowthBook can analyze this experiment's results.`
                    : t`Connect GrowthBook to your data to analyze this experiment's results automatically.`}
                </Callout>
              ) : (
                <Results
                  experiment={experiment}
                  mutateExperiment={mutate}
                  editMetrics={editMetrics ?? undefined}
                  newMetricStates={newMetricStates}
                  statsEngine={statsEngine}
                  analysisBarSettings={analysisBarSettings}
                  setAnalysisBarSettings={setAnalysisBarSettings}
                  isTabActive={isTabActive}
                  metricTagFilter={metricTagFilter}
                  metricsFilter={metricsFilter}
                  sliceTagsFilter={sliceTagsFilter}
                  setTab={setTab}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  sortDirection={sortDirection}
                  setSortDirection={setSortDirection}
                />
              )}
            </>
          )}
        </div>
      </div>
      {snapshot && !isDemoExperiment && (
        <Box className="appbox" mt="7">
          <div className="row mx-2 py-3 d-flex align-items-center">
            <div className="col ml-2">
              <div className="h3">
                <Trans>Custom Reports</Trans>
              </div>
              <div>
                {isBandit ? (
                  <Trans>
                    Create and share a stand-alone ad-hoc analysis without
                    affecting this Bandit.
                  </Trans>
                ) : (
                  <Trans>
                    Create and share a stand-alone ad-hoc analysis without
                    affecting this Experiment.
                  </Trans>
                )}
              </div>
            </div>
            <div className="col-auto mr-2">
              {permissionsUtil.canCreateReport(experiment) ? (
                <Button
                  onClick={async () => {
                    const res = await apiCall<{ report: ReportInterface }>(
                      `/experiments/report/${snapshot.id}`,
                      {
                        method: "POST",
                        body: reportArgs
                          ? JSON.stringify(reportArgs)
                          : undefined,
                      },
                    );
                    if (!res.report) {
                      throw new Error(t`Failed to create report`);
                    }
                    track("Experiment Report: Create", {
                      source: "experiment results tab",
                    });
                    await router.push(`/report/${res.report.id}`);
                  }}
                >
                  <Trans>New Custom Report</Trans>
                </Button>
              ) : null}
            </div>
          </div>
          <ExperimentReportsList experiment={experiment} />
        </Box>
      )}
    </div>
  );
}
