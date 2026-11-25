import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { resolveAnalysisIdentifierType } from "shared/util";
import { Fragment, useMemo, useState } from "react";
import { getScopedSettings } from "shared/settings";
import {
  expandMetricGroups,
  getMetricLink,
  isFactMetric,
} from "shared/experiments";
import { DEFAULT_TARGET_MDE } from "shared/constants";
import { Plural, Trans } from "@lingui/react/macro";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import AnalysisForm, {
  AnalysisFormFocus,
} from "@/components/Experiment/AnalysisForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { ExperimentMetricInterfaceWithComputedTargetMDE } from "@/components/Experiment/TabbedPage/DecisionMakingSettings";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";
import {
  getExposureQueriesInScope,
  isIdentifierUndeclared,
} from "@/services/datasources";
import { AssignmentQueryDriftIcon } from "@/components/Experiment/AssignmentQueryFields";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
  mutate?: () => void;
  canEdit: boolean;
  ssrPolyfills?: SSRPolyfills;
  isPublic?: boolean;
  holdoutProjects?: string[];
  // Lifted when something else on the page opens the settings modal too.
  settingsOpen?: boolean;
  setSettingsOpen?: (open: boolean) => void;
  settingsFocus?: AnalysisFormFocus | null;
}

export default function AnalysisSettings({
  experiment,
  mutate,
  envs,
  canEdit,
  ssrPolyfills,
  isPublic,
  holdoutProjects,
  settingsOpen,
  setSettingsOpen,
  settingsFocus = null,
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

  const [ownAnalysisModal, setOwnAnalysisModal] = useState(false);
  const analysisModal = settingsOpen ?? ownAnalysisModal;
  const setAnalysisModal = setSettingsOpen ?? setOwnAnalysisModal;

  const canEditAnalysisSettings =
    canEdit && permissionsUtil.canUpdateExperiment(experiment, {});

  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;

  const assignmentQuery = datasource?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );
  const identifierType = resolveAnalysisIdentifierType(
    assignmentQuery,
    experiment.exposureQueryIdentifierType,
  );
  const scopedQueries = datasource
    ? getExposureQueriesInScope(datasource, experiment.project, holdoutProjects)
    : [];

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
  const burnInValue = experiment.banditBurnInValue ?? 1;
  const scheduleValue = experiment.banditScheduleValue ?? 1;

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
          focus={settingsFocus}
          source={"analysis-settings"}
          envs={envs}
          holdoutProjects={holdoutProjects}
        />
      ) : null}

      <Frame>
        <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
          <Heading color="text-high" as="h4" size="sm" mb="0">
            <Trans>Analysis Settings</Trans>
          </Heading>
          <div className="flex-1" />
          {canEditAnalysisSettings ? (
            <Link onClick={() => setAnalysisModal(true)}>
              <Text weight="semibold">
                <Trans>Edit</Trans>
              </Text>
            </Link>
          ) : null}
        </div>

        {!isPublic && (
          <div className="row">
            <div className="col-4 mb-4">
              <Text color="text-high" weight="semibold">
                <Trans>Data Source</Trans>
              </Text>
              <div>
                <Text color="text-mid">
                  {datasource ? datasource.name : "--"}
                </Text>
              </div>
            </div>

            <div className="col-4 mb-4">
              <Text color="text-high" weight="semibold">
                <Trans>Experiment Assignment Table</Trans>
              </Text>
              <div>
                <Text color="text-mid">
                  {assignmentQuery ? assignmentQuery.name : "--"}
                </Text>{" "}
                <AssignmentQueryDriftIcon
                  selection={{
                    outOfScope:
                      !!assignmentQuery &&
                      !scopedQueries.some((q) => q.id === assignmentQuery.id),
                    identifierUndeclared: isIdentifierUndeclared(
                      assignmentQuery,
                      identifierType,
                    ),
                    identifierType,
                    holdoutProjects,
                  }}
                />
              </div>
            </div>

            <div className="col-4 mb-4">
              <Text color="text-high" weight="semibold">
                {experiment.isClusterExperiment ? (
                  <Trans>Identifier Types</Trans>
                ) : (
                  <Trans>Identifier Type</Trans>
                )}
              </Text>
              {experiment.isClusterExperiment ? (
                <>
                  <div>
                    <Text color="text-high" weight="medium">
                      <Trans>Cluster:</Trans>
                    </Text>{" "}
                    <Text color="text-mid">{identifierType || "--"}</Text>
                  </div>
                  <div>
                    <Text color="text-high" weight="medium">
                      <Trans>Subunit:</Trans>
                    </Text>{" "}
                    <Text color="text-mid">
                      {experiment.clusterSubUnitIdentifier || "--"}
                    </Text>
                  </div>
                </>
              ) : (
                <div>
                  <Text color="text-mid">{identifierType || "--"}</Text>
                </div>
              )}
            </div>

            {experiment.activationMetric && (
              <div className="col-4 mb-4">
                <Text color="text-high" weight="semibold">
                  <Trans>Activation Metric</Trans>
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
                  <Trans>Segment</Trans>
                </Text>
                <div>
                  <Text color="text-mid">
                    {experiment.segment ? (
                      getSegmentById(experiment.segment)?.name
                    ) : (
                      <Trans>all users</Trans>
                    )}
                  </Text>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="row mt-4">
          <div className="col-4 mb-4">
            <Text color="text-high" weight="semibold">
              {!isBandit ? (
                <Trans>Goal Metrics</Trans>
              ) : (
                <Trans>Decision Metric</Trans>
              )}
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
                              <Text size="sm" color="text-mid">
                                {experiment.banditConversionWindowUnit ===
                                "hours" ? (
                                  <Plural
                                    value={
                                      experiment.banditConversionWindowValue
                                    }
                                    one="Conversion Window: # hour"
                                    other="Conversion Window: # hours"
                                  />
                                ) : (
                                  <Plural
                                    value={
                                      experiment.banditConversionWindowValue
                                    }
                                    one="Conversion Window: # day"
                                    other="Conversion Window: # days"
                                  />
                                )}
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
              <Trans>Secondary Metrics</Trans>
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
                <Trans>Guardrail Metrics</Trans>
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
                <Trans>Exploratory Stage</Trans>
              </Text>
              <div>
                <Text color="text-mid">
                  {(experiment.banditBurnInUnit ?? "days") === "days" ? (
                    <Plural value={burnInValue} one="# day" other="# days" />
                  ) : (
                    <Plural value={burnInValue} one="# hour" other="# hours" />
                  )}
                </Text>
              </div>
            </div>

            <div className="col-4">
              <Text color="text-high" weight="semibold">
                <Trans>Update Cadence</Trans>
              </Text>
              <div>
                <Text color="text-mid">
                  {(experiment.banditScheduleUnit ?? "days") === "days" ? (
                    <Trans>Every {scheduleValue} days</Trans>
                  ) : (
                    <Trans>Every {scheduleValue} hours</Trans>
                  )}
                </Text>
              </div>
            </div>
          </div>
        )}
      </Frame>
    </>
  );
}
