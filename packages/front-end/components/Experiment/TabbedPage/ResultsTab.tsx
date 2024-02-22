import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { getScopedSettings } from "shared/settings";
import { useMemo, useState } from "react";
import { ReportInterface } from "back-end/types/report";
import uniq from "lodash/uniq";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Link from "next/link";
import { useRouter } from "next/router";
import { getAllMetricRegressionAdjustmentStatuses } from "shared/experiments";
import { MetricInterface } from "back-end/types/metric";
import { DifferenceType } from "back-end/types/stats";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import Button from "@/components/Button";
import { GBAddCircle } from "@/components/Icons";
import Results, { ResultsMetricFilters } from "../Results";
import AnalysisForm from "../AnalysisForm";
import ExperimentReportsList from "../ExperimentReportsList";
import { useSnapshot } from "../SnapshotProvider";
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
  linkedFeatures: LinkedFeatureInfo[];
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

  const { snapshot } = useSnapshot();

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

  const allExperimentMetricIds = uniq([
    ...experiment.metrics,
    ...(experiment.guardrails ?? []),
  ]);
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
    .filter(Boolean) as MetricInterface[];

  const orgSettings = useOrgSettings();

  const {
    regressionAdjustmentAvailable,
    regressionAdjustmentEnabled,
    regressionAdjustmentHasValidMetrics,
  } = useMemo(() => {
    return getAllMetricRegressionAdjustmentStatuses({
      allExperimentMetrics,
      denominatorMetrics,
      orgSettings,
      statsEngine,
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
    statsEngine,
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

  return (
    <>
      <div className="bg-white border mt-3">
        {analysisSettingsOpen && (
          <AnalysisForm
            cancel={() => setAnalysisSettingsOpen(false)}
            experiment={experiment}
            mutate={mutate}
            phase={experiment.phases.length - 1}
            editDates={false}
            editMetrics={true}
            editVariationIds={false}
          />
        )}
        <div className="mb-2" style={{ overflowX: "initial" }}>
          <AnalysisSettingsSummary
            experiment={experiment}
            mutate={mutate}
            statsEngine={statsEngine}
            editMetrics={editMetrics ?? undefined}
            setVariationFilter={(v: number[]) => setVariationFilter(v)}
            baselineRow={baselineRow}
            setBaselineRow={(b: number) => setBaselineRow(b)}
            setDifferenceType={setDifferenceType}
          />
          {experiment.status === "draft" ? (
            <div className="mx-3">
              <div className="alert bg-light border my-4">
                Your experiment is still in a <strong>draft</strong> state. You
                must start the experiment first before seeing results.
              </div>
            </div>
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
                      <Link href="/datasources">
                        <a className="btn btn-primary">Connect to your Data</a>
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
      {snapshot && (
        <div className="bg-white border mt-4">
          <div className="row mx-2 py-3 d-flex align-items-center">
            <div className="col h3 ml-2 mb-0">Custom Reports</div>
            <div className="col-auto mr-2">
              <Button
                className="btn btn-outline-primary float-right"
                color="outline-info"
                stopPropagation={true}
                onClick={async () => {
                  const res = await apiCall<{ report: ReportInterface }>(
                    `/experiments/report/${snapshot.id}`,
                    {
                      method: "POST",
                    }
                  );
                  if (!res.report) {
                    throw new Error("Failed to create report");
                  }
                  await router.push(`/report/${res.report.id}`);
                }}
              >
                <GBAddCircle className="pr-1" />
                Custom Report
              </Button>
            </div>
          </div>
          <ExperimentReportsList experiment={experiment} />
        </div>
      )}
    </>
  );
}
