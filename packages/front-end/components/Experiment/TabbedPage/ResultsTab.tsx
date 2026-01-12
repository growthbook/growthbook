import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FactTableColumnType } from "shared/types/fact-table";
import { getScopedSettings } from "shared/settings";
import React, { useState } from "react";
import {
  ExperimentSnapshotReportArgs,
  ReportInterface,
} from "shared/types/report";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import NextLink from "next/link";
import { useRouter } from "next/router";
import { DifferenceType } from "shared/types/stats";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { Box, Flex, Text } from "@radix-ui/themes";
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
import track from "@/services/track";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import AnalysisSettingsSummary from "./AnalysisSettingsSummary";
import { ExperimentTab } from ".";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
  newPhase?: (() => void) | null;
  visualChangesets: VisualChangesetInterface[];
  editTargeting?: (() => void) | null;
  envs: string[];
  setTab: (tab: ExperimentTab) => void;
  connections: SDKConnectionInterface[];
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
  setAnalysisBarSettings: (s: AnalysisBarSettings) => void;
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
  editResult,
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
}: Props) {
  const {
    getDatasourceById,
    getExperimentMetricById,
    getProjectById,
    metrics,
    datasources,
    getSegmentById,
  } = useDefinitions();

  const { apiCall } = useAuth();

  const [allowManualDatasource, setAllowManualDatasource] = useState(false);
  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false);
  const [analysisModal, setAnalysisModal] = useState(false);

  const router = useRouter();

  const { snapshot, analysis, setSnapshotType } = useSnapshot();

  const permissionsUtil = usePermissionsUtil();
  const { organization } = useUser();
  const project = getProjectById(experiment.project || "");

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
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  )?.userIdType;

  const reportArgs: ExperimentSnapshotReportArgs = {
    userIdType: userIdType as "user" | "anonymous" | undefined,
    differenceType: analysisBarSettings.differenceType,
    dimension: analysisBarSettings.dimension,
  };

  return (
    <div>
      {isBandit && hasResults ? (
        <Callout status="info" mb="5">
          Bandits are better than experiments at directing traffic to the best
          variation but they can produce biased results.
        </Callout>
      ) : null}

      <Box>
        <Flex direction="row" align="start" gap="3" mx="1" mb="4">
          {!(
            experiment.type === "multi-armed-bandit" &&
            experiment.status === "running"
          ) && permissionsUtil.canUpdateExperiment(experiment, {}) ? (
            <Link type="button" onClick={() => setAnalysisModal(true)} mr="2">
              Edit Settings
            </Link>
          ) : null}
          {hasData && (
            <>
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
                  analysis?.settings?.regressionAdjusted
                    ? "Enabled"
                    : "Disabled"
                }
              />
              <Metadata
                label="Post-Stratification"
                value={
                  analysis?.settings?.postStratificationEnabled
                    ? "Enabled"
                    : "Disabled"
                }
              />
              {analysis?.settings?.statsEngine === "frequentist" ? (
                <Metadata
                  label="Sequential"
                  value={
                    analysis?.settings?.sequentialTesting
                      ? "Enabled"
                      : "Disabled"
                  }
                />
              ) : null}
              {segment ? (
                <Metadata label="Segment" value={segment.name} />
              ) : null}
              {activationMetric ? (
                <Metadata
                  label="Activation Metric"
                  value={activationMetric.name}
                />
              ) : null}
              {isBandit && snapshot ? (
                <>
                  <Flex style={{ flex: 1 }} />
                  <Flex direction="column" align="end">
                    <Metadata
                      label="Analysis type"
                      value={
                        snapshot?.type === "exploratory" ? (
                          <Tooltip
                            body={
                              <div className="text-left">
                                <p>This is an exploratory analysis.</p>
                                <p>
                                  Exploratory analyses do not cause bandit
                                  variation weights to change.
                                </p>
                              </div>
                            }
                          >
                            Exploratory
                          </Tooltip>
                        ) : snapshot?.type === "standard" ? (
                          <Tooltip
                            body={
                              <div className="text-left">
                                <p>This is a standard analysis.</p>
                                <p>
                                  Bandit variation weights may have changed in
                                  response to this analysis.
                                </p>
                              </div>
                            }
                          >
                            Standard
                          </Tooltip>
                        ) : (
                          <span>{snapshot?.type || `unknown`}</span>
                        )
                      }
                    />
                    {snapshot?.type !== "standard" && (
                      <Link
                        onClick={() => setSnapshotType("standard")}
                        style={{ marginBottom: -8 }}
                      >
                        <Text size="1">View standard analysis</Text>
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
        {analysisSettingsOpen && (
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
          />
        )}
        {analysisModal && (
          <AnalysisForm
            cancel={() => setAnalysisModal(false)}
            envs={envs}
            experiment={experiment}
            mutate={mutate}
            phase={experiment.phases.length - 1}
            editDates={true}
            editVariationIds={false}
            editMetrics={true}
            source={"results-tab"}
          />
        )}
        <div className="mb-2" style={{ overflowX: "initial" }}>
          <AnalysisSettingsSummary
            experiment={experiment}
            mutate={mutate}
            statsEngine={statsEngine}
            editMetrics={editMetrics ?? undefined}
            baselineRow={analysisBarSettings.baselineRow}
            setVariationFilter={(v: number[]) =>
              setAnalysisBarSettings({
                ...analysisBarSettings,
                variationFilter: v,
              })
            }
            setBaselineRow={(b: number) =>
              setAnalysisBarSettings({ ...analysisBarSettings, baselineRow: b })
            }
            setDifferenceType={(d: DifferenceType) =>
              setAnalysisBarSettings({
                ...analysisBarSettings,
                differenceType: d,
              })
            }
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
          />
          {experiment.status === "draft" ? (
            <Callout status="info" mx="3" my="4">
              Your experiment is still in a <strong>draft</strong> state. You
              must start the experiment first before seeing results.
            </Callout>
          ) : (
            <>
              {experiment.status === "running" &&
              !experiment.datasource &&
              !allowManualDatasource &&
              !snapshot &&
              !experiment.id.match(/^exp_sample/) ? (
                <div className="alert-cool-1 text-center m-4 px-3 py-4">
                  <p className="h4">Use GrowthBook for Analysis</p>
                  {datasources.length > 0 ? (
                    <>
                      <p>
                        Select a Data Source and metrics so GrowthBook can
                        analyze the experiment results.
                      </p>
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setAnalysisSettingsOpen(true);
                        }}
                      >
                        Select Data Source
                      </button>
                    </>
                  ) : (
                    <>
                      <p>
                        Connect GrowthBook to your data and use our powerful
                        metrics and stats engine to automatically analyze your
                        experiment results.
                      </p>
                      <NextLink href="/datasources" className="btn btn-primary">
                        Connect to your Data
                      </NextLink>
                    </>
                  )}
                  {metrics.length > 0 && (
                    <div className="mt-3">
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setAllowManualDatasource(true);
                        }}
                      >
                        continue with manually entered data
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <Results
                  experiment={experiment}
                  mutateExperiment={mutate}
                  editMetrics={editMetrics ?? undefined}
                  editResult={editResult ?? undefined}
                  reportDetailsLink={false}
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
      {snapshot && (
        <div className="appbox mt-4">
          <div className="row mx-2 py-3 d-flex align-items-center">
            <div className="col ml-2">
              <div className="h3">Custom Reports</div>
              <div>
                Create and share a stand-alone ad-hoc analysis without affecting
                this {isBandit ? "Bandit" : "Experiment"}.
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
                      throw new Error("Failed to create report");
                    }
                    track("Experiment Report: Create", {
                      source: "experiment results tab",
                    });
                    await router.push(`/report/${res.report.id}`);
                  }}
                >
                  New Custom Report
                </Button>
              ) : null}
            </div>
          </div>
          <ExperimentReportsList experiment={experiment} />
        </div>
      )}
    </div>
  );
}
