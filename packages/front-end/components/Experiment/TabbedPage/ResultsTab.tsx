import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getScopedSettings } from "shared/settings";
import { useMemo } from "react";
import { MetricRegressionAdjustmentStatus } from "back-end/types/report";
import { DEFAULT_REGRESSION_ADJUSTMENT_ENABLED } from "shared/constants";
import { MetricInterface } from "back-end/types/metric";
import uniq from "lodash/uniq";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { getRegressionAdjustmentsForMetric } from "@/services/experiments";
import { useAuth } from "@/services/auth";
import Results from "../Results";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
  newPhase?: (() => void) | null;
  editPhases?: (() => void) | null;
}

export default function ResultsTab({
  experiment,
  mutate,
  editMetrics,
  editResult,
  newPhase,
  editPhases,
}: Props) {
  const { getDatasourceById, getMetricById, getProjectById } = useDefinitions();

  const { apiCall } = useAuth();

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
    getMetricById(m)
  );
  const denominatorMetricIds = uniq<string>(
    allExperimentMetrics.map((m) => m?.denominator).filter(Boolean) as string[]
  );
  const denominatorMetrics = denominatorMetricIds
    .map((m) => getMetricById(m as string))
    .filter(Boolean) as MetricInterface[];

  const orgSettings = useOrgSettings();

  const [
    regressionAdjustmentAvailable,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    regressionAdjustmentHasValidMetrics,
  ] = useMemo(() => {
    const metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[] = [];
    let regressionAdjustmentAvailable = true;
    let regressionAdjustmentEnabled = true;
    let regressionAdjustmentHasValidMetrics = false;
    for (const metric of allExperimentMetrics) {
      if (!metric) continue;
      const {
        metricRegressionAdjustmentStatus,
      } = getRegressionAdjustmentsForMetric({
        metric: metric,
        denominatorMetrics: denominatorMetrics,
        experimentRegressionAdjustmentEnabled:
          experiment.regressionAdjustmentEnabled ??
          DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
        organizationSettings: orgSettings,
        metricOverrides: experiment.metricOverrides,
      });
      if (metricRegressionAdjustmentStatus.regressionAdjustmentEnabled) {
        regressionAdjustmentEnabled = true;
        regressionAdjustmentHasValidMetrics = true;
      }
      metricRegressionAdjustmentStatuses.push(metricRegressionAdjustmentStatus);
    }
    if (!experiment.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = false;
    }
    if (statsEngine === "bayesian") {
      regressionAdjustmentAvailable = false;
      regressionAdjustmentEnabled = false;
    }
    if (
      !datasource?.type ||
      datasource?.type === "google_analytics" ||
      datasource?.type === "mixpanel"
    ) {
      // these do not implement getExperimentMetricQuery
      regressionAdjustmentAvailable = false;
      regressionAdjustmentEnabled = false;
    }
    if (!hasRegressionAdjustmentFeature) {
      regressionAdjustmentEnabled = false;
    }
    return [
      regressionAdjustmentAvailable,
      regressionAdjustmentEnabled,
      metricRegressionAdjustmentStatuses,
      regressionAdjustmentHasValidMetrics,
    ];
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

  const phases = experiment.phases || [];
  const experimentHasPhases = phases.length > 0;

  return (
    <div className="bg-white border mt-3">
      <div className="mb-2" style={{ overflowX: "initial" }}>
        {!experimentHasPhases ? (
          <div className="alert alert-info">
            You don&apos;t have any experiment phases yet.{" "}
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => newPhase && newPhase()}
            >
              Add Experiment Phase
            </button>
          </div>
        ) : experiment.status === "draft" ? (
          <div className="alert bg-light border">
            Your experiment is still in a <strong>draft</strong> state. You must
            click the &quot;Start Experiment&quot; button above to see results.
          </div>
        ) : (
          <Results
            experiment={experiment}
            mutateExperiment={mutate}
            editMetrics={editMetrics ?? undefined}
            editResult={editResult ?? undefined}
            editPhases={editPhases ?? undefined}
            alwaysShowPhaseSelector={false}
            reportDetailsLink={false}
            statsEngine={statsEngine}
            regressionAdjustmentAvailable={regressionAdjustmentAvailable}
            regressionAdjustmentEnabled={regressionAdjustmentEnabled}
            regressionAdjustmentHasValidMetrics={
              regressionAdjustmentHasValidMetrics
            }
            metricRegressionAdjustmentStatuses={
              metricRegressionAdjustmentStatuses
            }
            onRegressionAdjustmentChange={onRegressionAdjustmentChange}
          />
        )}
      </div>
    </div>
  );
}
