import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useMemo, useState } from "react";
import { getScopedSettings } from "shared/settings";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
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
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";
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
  ExperimentMetricInterface,
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
  const [editScheduleModal, setEditScheduleModal] = useState(false);

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

  // Summarize the end-of-experiment scheduled-stop plan.
  const plan = experiment.scheduledStopPlan;
  const shippingVariationName = (id?: string) =>
    experiment.variations.find((v) => v.id === id)?.name ?? "a variation";
  let endSummary: string;
  const endDetails: string[] = [];
  const tiebreakerName = () => {
    if (!plan?.tiebreakerMetricId) return null;
    const metric =
      ssrPolyfills?.getExperimentMetricById?.(plan.tiebreakerMetricId) ||
      getExperimentMetricById(plan.tiebreakerMetricId);
    return metric?.name ?? plan.tiebreakerMetricId;
  };
  if (plan?.mode === "auto-ship") {
    endSummary = "Ship the winning variation";
    const tb = tiebreakerName();
    if (tb) endDetails.push(`Tiebreaker: ${tb}`);
    endDetails.push(
      plan.fallback === "force-ship"
        ? `No clear winner: ship ${shippingVariationName(plan.fallbackVariationId)}`
        : "No clear winner: keep running",
    );
  } else if (plan?.mode === "force-ship") {
    endSummary = `Ship ${shippingVariationName(plan.fallbackVariationId)}`;
    const tb = tiebreakerName();
    if (tb) endDetails.push(`Verdict tiebreaker: ${tb}`);
  } else if (plan?.mode === "stop") {
    endSummary = "Stop the experiment (no rollout)";
    const tb = tiebreakerName();
    if (tb) endDetails.push(`Verdict tiebreaker: ${tb}`);
  } else {
    endSummary = "Notify only — keep running";
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
      {editScheduleModal && mutate ? (
        <EditScheduleModal
          experiment={experiment}
          mutate={mutate}
          close={() => setEditScheduleModal(false)}
        />
      ) : null}

      <Frame>
        <Flex direction="column" gap="1" mb="5">
          <Heading color="text-high" as="h4" size="small" mb="0">
            Decision-making Settings
          </Heading>
          <Text color="text-mid">
            Define the criteria and end-of-experiment automation that drive
            quick, precise rollouts for winning variations.
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
          <Box>
            <Text color="text-high" weight="semibold" mb="1">
              End of Experiment
            </Text>
            <Box>
              <Text as="div" color="text-mid">
                {endSummary}
              </Text>
              {endDetails.map((detail, i) => (
                <Text as="div" color="text-mid" key={`end-${i}`}>
                  {detail}
                </Text>
              ))}
            </Box>
            {canEditDecisionSettings && mutate && !isPublic ? (
              <Box mt="1">
                <Link
                  onClick={() => {
                    setEditScheduleModal(true);
                  }}
                >
                  View/Edit
                </Link>
              </Box>
            ) : null}
          </Box>
        </Grid>
      </Frame>
    </>
  );
}
