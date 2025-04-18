import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useMemo, useState } from "react";
import { getScopedSettings } from "shared/settings";
import { upperFirst } from "lodash";
import { expandMetricGroups, getMetricLink } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import useOrgSettings from "@/hooks/useOrgSettings";
import Link from "@/components/Radix/Link";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
  mutate?: () => void;
  canEdit: boolean;
  ssrPolyfills?: SSRPolyfills;
  isPublic?: boolean;
}

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
    getProjectById,
    getExperimentMetricById,
    getSegmentById,
    metricGroups,
  } = useDefinitions();

  const { getDecisionCriteria } = useRunningExperimentStatus();
  const decisionCriteria = getDecisionCriteria(experiment.decisionCriteriaId);

  const { organization } = useUser();
  const _settings = useOrgSettings();
  const settings = ssrPolyfills?.useOrgSettings() || _settings;
  const permissionsUtil = usePermissionsUtil();

  const [analysisModal, setAnalysisModal] = useState(false);

  const project =
    ssrPolyfills?.getProjectById(experiment.project || "") ||
    getProjectById(experiment.project || "");

  const canEditAnalysisSettings =
    canEdit && permissionsUtil.canUpdateExperiment(experiment, {});

  const { settings: scopedSettings } = getScopedSettings({
    organization: organization?.settings
      ? organization
      : { settings: settings },
    project: project ?? undefined,
    experiment: experiment,
  });

  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;

  const assignmentQuery = datasource?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId
  );

  const statsEngine = scopedSettings.statsEngine.value;

  const {
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
  } = useMemo(() => {
    const expandedGoals = expandMetricGroups(
      experiment.goalMetrics,
      ssrPolyfills?.metricGroups || metricGroups
    );
    const expandedSecondaries = expandMetricGroups(
      experiment.secondaryMetrics,
      ssrPolyfills?.metricGroups || metricGroups
    );
    const expandedGuardrails = expandMetricGroups(
      experiment.guardrailMetrics,
      ssrPolyfills?.metricGroups || metricGroups
    );

    return { expandedGoals, expandedSecondaries, expandedGuardrails };
  }, [
    experiment.goalMetrics,
    experiment.secondaryMetrics,
    experiment.guardrailMetrics,
    metricGroups,
    ssrPolyfills?.metricGroups,
  ]);

  const goals: { name: string; id: string }[] = [];
  expandedGoals.forEach((m) => {
    const name =
      ssrPolyfills?.getExperimentMetricById?.(m)?.name ||
      getExperimentMetricById(m)?.name;
    if (name) goals.push({ name, id: m });
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
          </div>
        )}

        <div className="row mt-4">
          <div className="col-4">
            <div className="h5">
              {!isBandit ? "Goal Metrics" : "Decision Metric"}
            </div>
            <div>
              {goals.length ? (
                <ul className="list-unstyled mb-0">
                  {goals.map((metric, i) => {
                    if (isBandit && i > 0) return null;
                    return (
                      <li key={`goal-${i}`}>
                        <Link href={getMetricLink(metric.id)}>
                          {metric.name}
                        </Link>
                      </li>
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

          <div className="col-4">
            <div className="h5">Guardrail Metrics</div>
            <div>
              {guardrails.length ? (
                <ul className="list-unstyled mb-0">
                  {guardrails.map((metric, i) => (
                    <li key={`guardrail-${i}`}>
                      <Link href={getMetricLink(metric.id)}>{metric.name}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <em>none</em>
              )}
            </div>
          </div>
        </div>

        {!isBandit ? (
          // && decisionFrameworkEnabled
          <div className="row mt-4">
            <div className="col-4">
              <div className="h5">Decision Criteria</div>
              <div>{decisionCriteria.name}</div>
            </div>

            <div className="col-4">
              <div className="h5">Target MDE</div>
              <div>
                {goals.map((metric, i) => {
                  return (
                    <li key={`goal-mde-${i}`}>
                      <Link href={getMetricLink(metric.id)}>{metric.name}</Link>
                    </li>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

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
