import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getScopedSettings } from "shared/settings";
import React, { useMemo, useState } from "react";
import {
  ExperimentSnapshotReportArgs,
  ReportInterface,
} from "back-end/types/report";
import uniq from "lodash/uniq";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Link from "next/link";
import { useRouter } from "next/router";
import { DifferenceType } from "back-end/types/stats";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import {
  getAllMetricIdsFromExperiment,
  getAllMetricSettingsForSnapshot,
} from "shared/experiments";
import { isDefined } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import Results, { ResultsMetricFilters } from "@/components/Experiment/Results";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import ExperimentReportsList from "@/components/Experiment/ExperimentReportsList";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/components/Radix/Callout";
import Button from "@/components/Radix/Button";
import track from "@/services/track";
import AnalysisSettingsSummary from "./AnalysisSettingsSummary";
import { ExperimentTab } from ".";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
  newPhase?: (() => void) | null;
  editPhases?: (() => void) | null;
  visualChangesets: VisualChangesetInterface[];
  editTargeting?: (() => void) | null;
  envs: string[];
  setTab: (tab: ExperimentTab) => void;
  connections: SDKConnectionInterface[];
  isTabActive: boolean;
  safeToEdit: boolean;
  baselineRow: number;
  setBaselineRow: (b: number) => void;
  differenceType: DifferenceType;
  setDifferenceType: (d: DifferenceType) => void;
  variationFilter: number[];
  setVariationFilter: (v: number[]) => void;
  metricFilter: ResultsMetricFilters;
  setMetricFilter: (m: ResultsMetricFilters) => void;
}

export default function ResultsTab({
  experiment,
  envs,
  mutate,
  editMetrics,
  editResult,
  editPhases,
  setTab,
  isTabActive,
  safeToEdit,
  baselineRow,
  setBaselineRow,
  differenceType,
  setDifferenceType,
  variationFilter,
  setVariationFilter,
  metricFilter,
  setMetricFilter,
}: Props) {
  const {
    getDatasourceById,
    getExperimentMetricById,
    getMetricById,
    getProjectById,
    metrics,
    datasources,
  } = useDefinitions();

  const { apiCall } = useAuth();

  const [allowManualDatasource, setAllowManualDatasource] = useState(false);

  const router = useRouter();

  const { snapshot, analysis, dimension } = useSnapshot();
  const permissionsUtil = usePermissionsUtil();

  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false);

  const { hasCommercialFeature, organization } = useUser();
  const project = getProjectById(experiment.project || "");

  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    experiment: experiment,
  });

  const datasource = getDatasourceById(experiment.datasource);

  const statsEngine = scopedSettings.statsEngine.value;

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );

  const allExperimentMetricIds = getAllMetricIdsFromExperiment(
    experiment,
    false
  );
  const allExperimentMetrics = allExperimentMetricIds.map((m) =>
    getExperimentMetricById(m)
  );
  const denominatorMetricIds = uniq<string>(
    allExperimentMetrics
      .map((m) => m?.denominator)
      .filter((d) => d && typeof d === "string") as string[]
  );
  const denominatorMetrics = denominatorMetricIds
    .map((m) => getMetricById(m as string))
    .filter(isDefined);

  const orgSettings = useOrgSettings();

  const {
    regressionAdjustmentAvailable,
    regressionAdjustmentEnabled,
    regressionAdjustmentHasValidMetrics,
  } = useMemo(() => {
    return getAllMetricSettingsForSnapshot({
      allExperimentMetrics,
      denominatorMetrics,
      orgSettings,
      experimentRegressionAdjustmentEnabled:
        experiment.regressionAdjustmentEnabled,
      experimentMetricOverrides: experiment.metricOverrides,
      datasourceType: datasource?.type,
      hasRegressionAdjustmentFeature,
    });
  }, [
    allExperimentMetrics,
    denominatorMetrics,
    orgSettings,
    experiment.regressionAdjustmentEnabled,
    experiment.metricOverrides,
    datasource?.type,
    hasRegressionAdjustmentFeature,
  ]);

  const onRegressionAdjustmentChange = async (enabled: boolean) => {
    await apiCall(`/experiment/${experiment.id}/`, {
      method: "POST",
      body: JSON.stringify({
        regressionAdjustmentEnabled: !!enabled,
      }),
    });
    mutate();
  };

  const hasData =
    (analysis?.results?.[0]?.variations?.length ?? 0) > 0 &&
    (analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE) === statsEngine;

  const hasResults =
    experiment.status !== "draft" &&
    hasData &&
    snapshot &&
    analysis?.results?.[0];

  const isBandit = experiment.type === "multi-armed-bandit";

  const datasourceSettings = experiment.datasource
    ? getDatasourceById(experiment.datasource)?.settings
    : undefined;
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId
  )?.userIdType;

  const reportArgs: ExperimentSnapshotReportArgs = {
    userIdType: userIdType as "user" | "anonymous" | undefined,
    differenceType,
    dimension,
  };

  return (
    <div className="mt-3">
      {isBandit && hasResults ? (
        <Callout status="info" mb="5">
          Bandits are better than experiments at directing traffic to the best
          variation but they can produce biased results.
          {/*todo: docs*/}
        </Callout>
      ) : null}

      <div className="bg-white border">
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
        <div className="mb-2" style={{ overflowX: "initial" }}>
          <AnalysisSettingsSummary
            experiment={experiment}
            envs={envs}
            mutate={mutate}
            statsEngine={statsEngine}
            editMetrics={editMetrics ?? undefined}
            setVariationFilter={(v: number[]) => setVariationFilter(v)}
            baselineRow={baselineRow}
            setBaselineRow={(b: number) => setBaselineRow(b)}
            setDifferenceType={setDifferenceType}
            reportArgs={reportArgs}
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
                      <Link href="/datasources" className="btn btn-primary">
                        Connect to your Data
                      </Link>
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
                  envs={envs}
                  mutateExperiment={mutate}
                  editMetrics={editMetrics ?? undefined}
                  editResult={editResult ?? undefined}
                  editPhases={(safeToEdit && editPhases) || undefined}
                  alwaysShowPhaseSelector={true}
                  reportDetailsLink={false}
                  statsEngine={statsEngine}
                  regressionAdjustmentAvailable={regressionAdjustmentAvailable}
                  regressionAdjustmentEnabled={regressionAdjustmentEnabled}
                  regressionAdjustmentHasValidMetrics={
                    regressionAdjustmentHasValidMetrics
                  }
                  onRegressionAdjustmentChange={onRegressionAdjustmentChange}
                  isTabActive={isTabActive}
                  variationFilter={variationFilter}
                  setVariationFilter={setVariationFilter}
                  baselineRow={baselineRow}
                  setBaselineRow={setBaselineRow}
                  differenceType={differenceType}
                  setDifferenceType={setDifferenceType}
                  metricFilter={metricFilter}
                  setMetricFilter={setMetricFilter}
                  setTab={setTab}
                />
              )}
            </>
          )}
        </div>
      </div>
      {snapshot && !isBandit && (
        <div className="bg-white border mt-4">
          <div className="row mx-2 py-3 d-flex align-items-center">
            <div className="col ml-2">
              <div className="h3">Custom Reports</div>
              <div>
                Create and share an ad-hoc analysis without affecting this
                experiment.
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
                      }
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
