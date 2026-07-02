import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Fragment, useMemo, useState } from "react";
import { getScopedSettings } from "shared/settings";
import {
  expandMetricGroups,
  getMetricLink,
  isFactMetric,
} from "shared/experiments";
import { DEFAULT_TARGET_MDE } from "shared/constants";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { ExperimentMetricInterfaceWithComputedTargetMDE } from "@/components/Experiment/TabbedPage/DecisionMakingSettings";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";

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
    getExperimentMetricById,
    getMetricById,
    getSegmentById,
    segments,
    metricGroups,
  } = useDefinitions();
  const { organization } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [analysisModal, setAnalysisModal] = useState(false);

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
      const expandedGoals = [
        ...new Set(
          expandMetricGroups(
            experiment.goalMetrics,
            ssrPolyfills?.metricGroups || metricGroups,
          ),
        ),
      ];
      const expandedSecondaries = [
        ...new Set(
          expandMetricGroups(
            experiment.secondaryMetrics,
            ssrPolyfills?.metricGroups || metricGroups,
          ),
        ),
      ];
      const expandedGuardrails = [
        ...new Set(
          expandMetricGroups(
            experiment.guardrailMetrics,
            ssrPolyfills?.metricGroups || metricGroups,
          ),
        ),
      ];

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

      <Frame>
        <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
          <Heading color="text-high" as="h4" size="small" mb="0">
            Analysis Settings
          </Heading>
          <div className="flex-1" />
          {canEditAnalysisSettings ? (
            <Link onClick={() => setAnalysisModal(true)}>
              <Text weight="semibold">Edit</Text>
            </Link>
          ) : null}
        </div>

        {!isPublic && (
          <div className="row">
            <div className="col-4 mb-4">
              <Text color="text-high" weight="semibold">
                Data Source
              </Text>
              <div>
                <Text color="text-mid">
                  {datasource ? datasource.name : "--"}
                </Text>
              </div>
            </div>

            <div className="col-4 mb-4">
              <Text color="text-high" weight="semibold">
                Experiment Assignment Table
              </Text>
              <div>
                <Text color="text-mid">
                  {assignmentQuery ? assignmentQuery.name : "--"}
                </Text>
              </div>
            </div>

            {experiment.activationMetric && (
              <div className="col-4 mb-4">
                <Text color="text-high" weight="semibold">
                  Activation Metric
                </Text>
                <div>
                  <Text color="text-mid">
                    {getExperimentMetricById(experiment.activationMetric)?.name}
                  </Text>
                </div>
              </div>
            )}
            {!isHoldout && (segments.length > 0 || experiment.segment) && (
              <div className="col-4 mb-4">
                <Text color="text-high" weight="semibold">
                  Segment
                </Text>
                <div>
                  <Text color="text-mid">
                    {experiment.segment
                      ? getSegmentById(experiment.segment)?.name
                      : "all users"}
                  </Text>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="row mt-4">
          <div className="col-4 mb-4">
            <Text color="text-high" weight="semibold">
              {!isBandit ? "Goal Metrics" : "Decision Metric"}
            </Text>
            <div>
              {goalsWithTargetMDE.length ? (
                <ul className="list-unstyled mb-0">
                  {goalsWithTargetMDE.map((metric, i) => {
                    if (isBandit && i > 0) return null;
                    return (
                      <Fragment key={metric.id}>
                        <li>
                          <Link href={getMetricLink(metric.id)}>
                            {metric.name}
                          </Link>
                        </li>
                        <li>
                          {isBandit &&
                            experiment.banditConversionWindowValue &&
                            experiment.banditConversionWindowUnit && (
                              <Text size="small" color="text-mid">
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
                      </Fragment>
                    );
                  })}
                </ul>
              ) : (
                <Text color="text-mid">--</Text>
              )}
            </div>
          </div>

          <div className="col-4">
            <Text color="text-high" weight="semibold">
              Secondary Metrics
            </Text>
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
                <Text color="text-mid">--</Text>
              )}
            </div>
          </div>
          {!isHoldout && (
            <div className="col-4">
              <Text color="text-high" weight="semibold">
                Guardrail Metrics
              </Text>
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
                  <Text color="text-mid">--</Text>
                )}
              </div>
            </div>
          )}
        </div>
        {isBandit && (
          <div className="row mt-4">
            <div className="col-4">
              <Text color="text-high" weight="semibold">
                Exploratory Stage
              </Text>
              <div>
                <Text color="text-mid">
                  {experiment.banditBurnInValue ?? 1}{" "}
                  {(experiment.banditBurnInUnit ?? "days") === "days"
                    ? "day"
                    : "hour"}
                  {(experiment.banditBurnInValue ?? 1) !== 1 ? "s" : ""}
                </Text>
              </div>
            </div>

            <div className="col-4">
              <Text color="text-high" weight="semibold">
                Update Cadence
              </Text>
              <div>
                <Text color="text-mid">
                  Every {experiment.banditScheduleValue ?? 1}{" "}
                  {(experiment.banditScheduleUnit ?? "days") === "days"
                    ? "days"
                    : "hours"}
                </Text>
              </div>
            </div>
          </div>
        )}
      </Frame>
    </>
  );
}
