import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useMemo, useState } from "react";
import { getScopedSettings } from "shared/settings";
import {
  expandMetricGroups,
  ExperimentMetricDefinition,
  isFactMetric,
} from "shared/experiments";
import { DEFAULT_TARGET_MDE } from "shared/constants";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Link from "@/ui/Link";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import DecisionCriteriaSelectorModal from "@/components/DecisionCriteria/DecisionCriteriaSelectorModal";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import TargetMDEModal from "@/components/Experiment/TabbedPage/TargetMDEModal";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
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
  ExperimentMetricDefinition,
  "targetMDE"
> & {
  computedTargetMDE: number;
  metricTargetMDE: number;
};

export default function DecisionMakingSettings({
  experiment,
  mutate,
  canEdit,
  ssrPolyfills,
  isPublic,
}: Props) {
  const { getExperimentMetricById, getMetricById, metricGroups } =
    useDefinitions();
  const { organization, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const hasDecisionFramework =
    organization?.settings?.decisionFrameworkEnabled &&
    hasCommercialFeature("decision-framework");

  const { getDecisionCriteria } = useRunningExperimentStatus();
  const decisionCriteria = getDecisionCriteria(
    experiment.decisionFrameworkSettings?.decisionCriteriaId,
  );

  const [targetMDEModal, setTargetMDEModal] = useState(false);
  const [decisionCriteriaModal, setDecisionCriteriaModal] = useState(false);

  const canEditDecisionSettings =
    canEdit && permissionsUtil.canUpdateExperiment(experiment, {});

  const expandedGoals = useMemo(
    () =>
      expandMetricGroups(
        experiment.goalMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      ),
    [experiment.goalMetrics, metricGroups, ssrPolyfills?.metricGroups],
  );

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

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";

  if (!hasDecisionFramework || isBandit || isHoldout) {
    return null;
  }

  return (
    <>
      {decisionCriteriaModal &&
      mutate &&
      canEditDecisionSettings &&
      !isPublic ? (
        <DecisionCriteriaSelectorModal
          initialCriteria={decisionCriteria}
          experiment={experiment}
          onSubmit={() => {
            setDecisionCriteriaModal(false);
            mutate();
          }}
          onClose={() => setDecisionCriteriaModal(false)}
          canEdit={canEditDecisionSettings}
        />
      ) : decisionCriteriaModal ? (
        <DecisionCriteriaModal
          decisionCriteria={decisionCriteria}
          editable={false}
          mutate={() => {}}
          onClose={() => setDecisionCriteriaModal(false)}
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

      <Frame>
        <Flex direction="column" gap="1" mb="5">
          <Heading color="text-high" as="h4" size="small" mb="0">
            Decision-making Settings
          </Heading>
          <Text color="text-mid">
            Define criteria to encourage quick and precise rollouts for winning
            variations.
          </Text>
        </Flex>

        <Grid columns="3" gap="4">
          <Box>
            <Text color="text-high" weight="semibold" mb="1">
              Target MDE
            </Text>
            <Box>
              {goalsWithTargetMDE.length ? (
                <ul className="list-unstyled mb-0">
                  {goalsWithTargetMDE.map((metric, i) => (
                    <li key={`goal-mde-${i}`}>
                      <Text color="text-mid">
                        {metric.name} (
                        {percentFormatter.format(metric.computedTargetMDE)})
                      </Text>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text color="text-mid">--</Text>
              )}
            </Box>
            {canEditDecisionSettings && !isPublic ? (
              <Box mt="1">
                <Link
                  onClick={() => {
                    setTargetMDEModal(true);
                  }}
                >
                  View/Edit
                </Link>
              </Box>
            ) : null}
          </Box>
          <Box>
            <Text color="text-high" weight="semibold" mb="1">
              Decision Criteria
            </Text>
            <Box>
              <Text color="text-mid">{decisionCriteria.name}</Text>
              <Text color="text-mid">{`: ${decisionCriteria.description}`}</Text>
            </Box>
            <Box mt="1">
              <Link
                onClick={() => {
                  setDecisionCriteriaModal(true);
                }}
              >
                {canEditDecisionSettings && !isPublic ? "View/Edit" : "View"}
              </Link>
            </Box>
          </Box>
        </Grid>
      </Frame>
    </>
  );
}
