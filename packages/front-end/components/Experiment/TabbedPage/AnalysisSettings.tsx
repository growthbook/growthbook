import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useMemo, useState } from "react";
import { getScopedSettings } from "shared/settings";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getMetricLink,
  isFactMetric,
} from "shared/experiments";
import { DEFAULT_TARGET_MDE } from "shared/constants";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Link from "@/ui/Link";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import DecisionCriteriaSelectorModal from "@/components/DecisionCriteria/DecisionCriteriaSelectorModal";
import TargetMDEModal from "@/components/Experiment/TabbedPage/TargetMDEModal";
import { AppFeatures } from "@/types/app-features";
import Text from "@/ui/Text";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
  mutate?: () => void;
  canEdit: boolean;
  ssrPolyfills?: SSRPolyfills;
  isPublic?: boolean;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export type ExperimentMetricInterfaceWithComputedTargetMDE = Omit<
  ExperimentMetricInterface,
  "targetMDE"
> & {
  computedTargetMDE: number;
  metricTargetMDE: number;
};

export default function AnalysisSettings({
  experiment,
  mutate,
  envs,
  canEdit,
  ssrPolyfills,
  isPublic,
}: Props) {
  const {
    getDatasourceById,
    getExperimentMetricById,
    getMetricById,
    getSegmentById,
    metricGroups,
  } = useDefinitions();
  const { organization, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const growthbook = useGrowthBook<AppFeatures>();
  const hasDecisionFramework =
    growthbook.isOn("decision-framework-criteria") &&
    organization?.settings?.decisionFrameworkEnabled &&
    hasCommercialFeature("decision-framework");

  const { getDecisionCriteria } = useRunningExperimentStatus();
  const decisionCriteria = getDecisionCriteria(
    experiment.decisionFrameworkSettings?.decisionCriteriaId,
  );

  const [analysisModal, setAnalysisModal] = useState(false);
  const [targetMDEModal, setTargetMDEModal] = useState(false);
  const [decisionCriteriaModal, setDecisionCriteriaModal] = useState(false);

  const canEditAnalysisSettings =
    canEdit && permissionsUtil.canUpdateExperiment(experiment, {});

  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;

  const assignmentQuery = datasource?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );

  const { expandedGoals, expandedSecondaries, expandedGuardrails } =
    useMemo(() => {
      const expandedGoals = expandMetricGroups(
        experiment.goalMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedSecondaries = expandMetricGroups(
        experiment.secondaryMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedGuardrails = expandMetricGroups(
        experiment.guardrailMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );

      return { expandedGoals, expandedSecondaries, expandedGuardrails };
    }, [
      experiment.goalMetrics,
      experiment.secondaryMetrics,
      experiment.guardrailMetrics,
      metricGroups,
      ssrPolyfills?.metricGroups,
    ]);

  const goalsWithTargetMDE: ExperimentMetricInterfaceWithComputedTargetMDE[] =
    [];
  expandedGoals.forEach((m) => {
    const metric =
      ssrPolyfills?.getExperimentMetricById?.(m) || getExperimentMetricById(m);
    if (metric) {
      // For legacy metrics with a denominator, look up the denominator metric
      const denominatorMetric =
        !isFactMetric(metric) && metric.denominator
          ? getMetricById(metric.denominator)
          : undefined;
      const { settings: scopedSettings } = getScopedSettings({
        organization,
        experiment,
        metric,
        denominatorMetric: denominatorMetric ?? undefined,
      });
      goalsWithTargetMDE.push({
        ...metric,
        computedTargetMDE: scopedSettings.targetMDE.value ?? DEFAULT_TARGET_MDE,
        metricTargetMDE: metric.targetMDE ?? DEFAULT_TARGET_MDE,
      });
    }
  });
  const secondary: { name: string; id: string }[] = [];
  expandedSecondaries.forEach((m) => {
    const name =
      ssrPolyfills?.getExperimentMetricById?.(m)?.name ||
      getExperimentMetricById(m)?.name;
    if (name) secondary.push({ name, id: m });
  });
  const guardrails: { name: string; id: string }[] = [];
  expandedGuardrails.forEach((m) => {
    const name =
      ssrPolyfills?.getExperimentMetricById?.(m)?.name ||
      getExperimentMetricById(m)?.name;
    if (name) guardrails.push({ name, id: m });
  });

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";

  return (
    <>
      {analysisModal && mutate ? (
        <AnalysisForm
          cancel={() => setAnalysisModal(false)}
          experiment={experiment}
          mutate={mutate}
          phase={experiment.phases.length - 1}
          editDates={true}
          editVariationIds={false}
          editMetrics={true}
          source={"analysis-settings"}
          envs={envs}
        />
      ) : null}

      {decisionCriteriaModal && mutate ? (
        <DecisionCriteriaSelectorModal
          initialCriteria={decisionCriteria}
          experiment={experiment}
          onSubmit={() => {
            setDecisionCriteriaModal(false);
            mutate();
          }}
          onClose={() => setDecisionCriteriaModal(false)}
          canEdit={canEditAnalysisSettings}
        />
      ) : null}
      {targetMDEModal && mutate ? (
        <TargetMDEModal
          goalsWithTargetMDE={goalsWithTargetMDE}
          experiment={experiment}
          onSubmit={() => {
            setTargetMDEModal(false);
            mutate();
          }}
          onClose={() => setTargetMDEModal(false)}
        />
      ) : null}

      <div className="box p-4 my-4">
        <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
          <h4 className="m-0">Analysis Settings</h4>
          <div className="flex-1" />
          {canEditAnalysisSettings ? (
            <button
              className="btn p-0 link-purple"
              onClick={() => {
                setAnalysisModal(true);
              }}
            >
              Edit
            </button>
          ) : null}
        </div>

        {!isPublic && (
          <div className="row">
            <div className="col-4 mb-4">
              <div className="h5">Data Source</div>
              <div>{datasource ? datasource.name : <em>none</em>}</div>
            </div>

            <div className="col-4 mb-4">
              <div className="h5">Experiment Assignment Table</div>
              <div>
                {assignmentQuery ? assignmentQuery.name : <em>none</em>}
              </div>
            </div>

            {experiment.activationMetric && (
              <div className="col-4 mb-4">
                <div className="h5">Activation Metric</div>
                <div>
                  {getExperimentMetricById(experiment.activationMetric)?.name}
                </div>
              </div>
            )}
            {!isHoldout && (
              <div className="col-4 mb-4">
                <div className="h5">Segment</div>
                <div>
                  {experiment.segment ? (
                    <>{getSegmentById(experiment.segment)?.name}</>
                  ) : (
                    <em>none (all users)</em>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="row mt-4">
          <div className="col-4 mb-4">
            <div className="h5">
              {!isBandit ? "Goal Metrics" : "Decision Metric"}
            </div>
            <div>
              {goalsWithTargetMDE.length ? (
                <ul className="list-unstyled mb-0">
                  {goalsWithTargetMDE.map((metric, i) => {
                    if (isBandit && i > 0) return null;
                    return (
                      <>
                        <li key={`goal-${i}`}>
                          <Link href={getMetricLink(metric.id)}>
                            {metric.name}
                          </Link>
                        </li>
                        <li key={`goal-${i}-conversion-window`}>
                          {isBandit &&
                            experiment.banditConversionWindowValue &&
                            experiment.banditConversionWindowUnit && (
                              <Text size="small">
                                Conversion Window:{" "}
                                {experiment.banditConversionWindowValue}{" "}
                                {experiment.banditConversionWindowValue === 1
                                  ? experiment.banditConversionWindowUnit.slice(
                                      0,
                                      -1,
                                    )
                                  : experiment.banditConversionWindowUnit}
                              </Text>
                            )}
                        </li>
                      </>
                    );
                  })}
                </ul>
              ) : (
                <em>none</em>
              )}
            </div>
          </div>

          <div className="col-4">
            <div className="h5">Secondary Metrics</div>
            <div>
              {secondary.length ? (
                <ul className="list-unstyled mb-0">
                  {secondary.map((metric, i) => (
                    <li key={`secondary-${i}`}>
                      <Link href={getMetricLink(metric.id)}>{metric.name}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <em>none</em>
              )}
            </div>
          </div>
          {!isHoldout && (
            <div className="col-4">
              <div className="h5">Guardrail Metrics</div>
              <div>
                {guardrails.length ? (
                  <ul className="list-unstyled mb-0">
                    {guardrails.map((metric, i) => (
                      <li key={`guardrail-${i}`}>
                        <Link href={getMetricLink(metric.id)}>
                          {metric.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <em>none</em>
                )}
              </div>
            </div>
          )}
        </div>
        {!isBandit && !isHoldout && hasDecisionFramework && (
          <div className="row mt-4">
            <div className="col-4">
              <div className="h5">Target MDE</div>
              <div>
                {goalsWithTargetMDE.length ? (
                  <ul className="list-unstyled mb-0">
                    {goalsWithTargetMDE.map((metric, i) => {
                      return (
                        <li key={`goal-mde-${i}`}>
                          {metric.name} (
                          {percentFormatter.format(metric.computedTargetMDE)})
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <em>none</em>
                )}
              </div>
              {canEditAnalysisSettings ? (
                <div className="mt-1">
                  <Link
                    onClick={() => {
                      setTargetMDEModal(true);
                    }}
                  >
                    View/Edit
                  </Link>
                </div>
              ) : null}
            </div>
            <div className="col-4">
              <div className="h5">Decision Criteria</div>
              <div>
                <Text weight="regular">{decisionCriteria.name}</Text>
                <Text color="text-mid">{`: ${decisionCriteria.description}`}</Text>
              </div>
              <div className="mt-1">
                <Link
                  onClick={() => {
                    setDecisionCriteriaModal(true);
                  }}
                >
                  {canEditAnalysisSettings ? "View/Edit" : "View"}
                </Link>
              </div>
            </div>
          </div>
        )}
        {isBandit && (
          <div className="row mt-4">
            <div className="col-4">
              <div className="h5">Exploratory Stage</div>
              <div>
                {experiment.banditBurnInValue ?? 1}{" "}
                {(experiment.banditBurnInUnit ?? "days") === "days"
                  ? "day"
                  : "hour"}
                {(experiment.banditBurnInValue ?? 1) !== 1 ? "s" : ""}
              </div>
            </div>

            <div className="col-4">
              <div className="h5">Update Cadence</div>
              <div>
                Every {experiment.banditScheduleValue ?? 1}{" "}
                {(experiment.banditScheduleUnit ?? "days") === "days"
                  ? "days"
                  : "hours"}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
