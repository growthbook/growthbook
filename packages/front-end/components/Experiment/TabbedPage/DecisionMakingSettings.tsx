import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ReactNode, useMemo, useState } from "react";
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
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Link from "@/ui/Link";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Frame from "@/ui/Frame";
import VariationLabel from "@/ui/VariationLabel";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  ssrPolyfills?: SSRPolyfills;
}

export const percentFormatter = new Intl.NumberFormat(undefined, {
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

/** Whether the decision framework, and so each goal's target MDE, applies. */
export function useDecisionFrameworkApplies(
  experiment: Pick<ExperimentInterfaceStringDates, "type">,
): boolean {
  const { organization, hasCommercialFeature } = useUser();
  return (
    !!organization?.settings?.decisionFrameworkEnabled &&
    hasCommercialFeature("decision-framework") &&
    experiment.type !== "multi-armed-bandit" &&
    experiment.type !== "holdout"
  );
}

/**
 * Each goal's target MDE, the decision criteria and the end-of-experiment plan;
 * null where the decision framework doesn't apply.
 */
export function useDecisionMakingSummary(
  experiment: ExperimentInterfaceStringDates,
  ssrPolyfills?: SSRPolyfills,
) {
  const { getExperimentMetricById, getMetricById, metricGroups } =
    useDefinitions();
  const { organization } = useUser();
  const { getDecisionCriteria } = useRunningExperimentStatus();
  const applies = useDecisionFrameworkApplies(experiment);

  const expandedGoals = useMemo(
    () =>
      expandMetricGroups(
        experiment.goalMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      ),
    [experiment.goalMetrics, metricGroups, ssrPolyfills?.metricGroups],
  );

  if (!applies) return null;

  const metricById = (id: string) =>
    ssrPolyfills?.getExperimentMetricById?.(id) || getExperimentMetricById(id);

  const goalsWithTargetMDE: ExperimentMetricInterfaceWithComputedTargetMDE[] =
    [];
  expandedGoals.forEach((m) => {
    const metric = metricById(m);
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

  const plan = experiment.statusUpdateSchedule?.scheduledStopPlan;
  // A phrase ending in the variation it ships, labelled as variations are.
  const shipping = (phrase: string, id?: string) => {
    const index = experiment.variations.findIndex((v) => v.id === id);
    return index < 0 ? (
      `${phrase} a variation`
    ) : (
      <Flex as="span" align="center" gap="1" minWidth="0">
        <Box as="span" flexShrink="0">
          {phrase}
        </Box>
        <VariationLabel
          number={index}
          name={experiment.variations[index].name || `Variation ${index}`}
        />
      </Flex>
    );
  };
  let endSummary: ReactNode;
  const endDetails: ReactNode[] = [];
  const tiebreakerName = () => {
    if (!plan?.tiebreakerMetricId) return null;
    return metricById(plan.tiebreakerMetricId)?.name ?? plan.tiebreakerMetricId;
  };
  if (plan?.mode === "auto-ship") {
    endSummary = "Ship the winning variation";
    const tb = tiebreakerName();
    if (tb) endDetails.push(`Tiebreaker: ${tb}`);
    endDetails.push(
      plan.fallback === "force-ship"
        ? shipping("No clear winner: ship", plan.fallbackVariationId)
        : "No clear winner: keep running",
    );
  } else if (plan?.mode === "force-ship") {
    endSummary = shipping("Ship", plan.fallbackVariationId);
    const tb = tiebreakerName();
    if (tb) endDetails.push(`Verdict tiebreaker: ${tb}`);
  } else if (plan?.mode === "stop") {
    endSummary = "Stop the experiment (no rollout)";
    const tb = tiebreakerName();
    if (tb) endDetails.push(`Verdict tiebreaker: ${tb}`);
  } else {
    endSummary = "Notify only — keep running";
  }

  return {
    goalsWithTargetMDE,
    decisionCriteria: getDecisionCriteria(
      experiment.decisionFrameworkSettings?.decisionCriteriaId,
    ),
    endSummary,
    endDetails,
  };
}

// Read-only, for the public page.
export default function DecisionMakingSettings({
  experiment,
  ssrPolyfills,
}: Props) {
  const summary = useDecisionMakingSummary(experiment, ssrPolyfills);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  if (!summary) return null;
  const { goalsWithTargetMDE, decisionCriteria, endSummary, endDetails } =
    summary;

  return (
    <>
      {criteriaOpen ? (
        <DecisionCriteriaModal
          decisionCriteria={decisionCriteria}
          editable={false}
          mutate={() => {}}
          onClose={() => setCriteriaOpen(false)}
        />
      ) : null}

      <Frame>
        <Flex direction="column" gap="1" mb="5">
          <Heading color="text-high" as="h4" size="sm" mb="0">
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
              <Link onClick={() => setCriteriaOpen(true)}>View</Link>
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
          </Box>
        </Grid>
      </Frame>
    </>
  );
}
