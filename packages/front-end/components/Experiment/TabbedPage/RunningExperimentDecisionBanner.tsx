import { Flex } from "@radix-ui/themes";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
  VariationWithIndex,
} from "shared/types/experiment";
import { useState } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import {
  buildTiebreakerLiftMap,
  resolveScheduledShipDecision,
} from "shared/enterprise";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import ExperimentDecisionExplanation from "./ExperimentDecisionExplanation";
import ExperimentBanner from "./ExperimentBanner";
import { useEditsBlockedReason } from "./ExperimentEdits";

const DECISIONS = {
  "ship-now": { label: "Ship now", color: "green", variant: "solid" },
  "ready-for-review": {
    label: "Ready for review",
    color: "amber",
    variant: "soft",
  },
  "rollback-now": { label: "Roll back now", color: "red", variant: "solid" },
} as const;

type Decision = Extract<
  ExperimentResultStatusData,
  { status: keyof typeof DECISIONS }
>;
const isDecision = (data: ExperimentResultStatusData): data is Decision =>
  data.status in DECISIONS;

/** The variations a recommendation is about; none when there's none to show. */
export function decidedVariations(
  experiment: ExperimentInterfaceStringDates,
  data: ExperimentResultStatusData,
): VariationWithIndex[] {
  if (!isDecision(data)) return [];
  const indexed = getLatestPhaseVariations(experiment).map<VariationWithIndex>(
    (v, i) => ({ ...v, index: i }),
  );
  return data.variations
    .map(({ variationId }) => indexed.find((v) => v.id === variationId))
    .filter((v) => v !== undefined);
}

type Props = {
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus: ExperimentResultStatusData;
  decisionCriteria: DecisionCriteriaData;
  showDecisionCriteriaLink?: boolean;
  // Opens the form that stops it with a result.
  makeDecision?: () => void;
} & MarginProps;

export default function RunningExperimentDecisionBanner({
  experiment,
  runningExperimentStatus,
  decisionCriteria,
  showDecisionCriteriaLink = true,
  makeDecision,
  ...margin
}: Props) {
  const [showDecisionCriteria, setShowDecisionCriteria] = useState(false);
  const blockedReason = useEditsBlockedReason();
  const { snapshot, analysis } = useSnapshot();
  const { getExperimentMetricById } = useDefinitions();

  const decided = decidedVariations(experiment, runningExperimentStatus);
  if (!isDecision(runningExperimentStatus) || !decided.length) return null;
  const { status } = runningExperimentStatus;

  const variationNames: Record<string, JSX.Element> = {};
  getLatestPhaseVariations(experiment).forEach((v) => {
    variationNames[v.id] = <VariationLabel number={v.index} name={v.name} />;
  });

  // An ambiguous multi-winner ship is resolved at the scheduled end by the
  // tiebreaker metric. Surface that here so it's visible before the end date.
  const tiebreakerMetricId =
    experiment.statusUpdateSchedule?.scheduledStopPlan?.tiebreakerMetricId;
  const isShipTie =
    status === "ship-now" &&
    runningExperimentStatus.variations.length > 1 &&
    !!tiebreakerMetricId;
  const tiebreakerMetric = tiebreakerMetricId
    ? getExperimentMetricById(tiebreakerMetricId)
    : null;
  const tiebreakerMetricName = tiebreakerMetric?.name ?? tiebreakerMetricId;

  let tiebreakerWinnerId: string | null = null;
  if (isShipTie && tiebreakerMetricId && analysis && snapshot) {
    const liftMap = buildTiebreakerLiftMap({
      variations: analysis.results?.[0]?.variations ?? [],
      snapshotVariationIds: snapshot.settings.variations.map((v) => v.id),
      metricId: tiebreakerMetricId,
      inverse: tiebreakerMetric?.inverse,
    });
    const decision = resolveScheduledShipDecision({
      resultStatus: runningExperimentStatus,
      tiebreakerLiftByVariationId: liftMap,
    });
    if (decision.action === "ship") tiebreakerWinnerId = decision.variationId;
  }

  const decision = DECISIONS[status];
  const tiebreakerWinner = tiebreakerWinnerId
    ? variationNames[tiebreakerWinnerId]
    : null;

  const banner = (
    <ExperimentBanner
      headline={
        <>
          <Badge
            label={decision.label}
            color={decision.color}
            variant={decision.variant}
            radius="full"
          />
          {/* A long name ends in an ellipsis rather than wrapping the row. */}
          <Flex align="center" gap="2" minWidth="0">
            {decided.map((v, i) => (
              <Flex key={v.id} align="center" minWidth="0">
                <VariationLabel
                  number={v.index}
                  name={v.name}
                  maxWidth="240px"
                />
                {i !== decided.length - 1 ? (
                  <Text color="text-mid">,</Text>
                ) : null}
              </Flex>
            ))}
          </Flex>
          {isShipTie ? (
            <>
              <Text color="text-low">·</Text>
              <Flex align="center" gap="1">
                <Text color="text-low">
                  Ties broken by {tiebreakerMetricName}
                  {tiebreakerWinner ? ":" : "…"}
                </Text>
                {tiebreakerWinner}
              </Flex>
            </>
          ) : null}
        </>
      }
      details={
        <ExperimentDecisionExplanation
          status={runningExperimentStatus}
          variations={runningExperimentStatus.variations}
          variationNames={variationNames}
          showDecisionCriteria={showDecisionCriteria}
          setShowDecisionCriteria={setShowDecisionCriteria}
          showDecisionCriteriaLink={showDecisionCriteriaLink}
          action={
            makeDecision ? (
              <Tooltip content={blockedReason} enabled={!!blockedReason}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={makeDecision}
                  disabled={!!blockedReason}
                >
                  Make decision
                </Button>
              </Tooltip>
            ) : null
          }
          reasonColor={decision.color}
        />
      }
      {...margin}
    />
  );
  return (
    <>
      {showDecisionCriteria && (
        <DecisionCriteriaModal
          decisionCriteria={decisionCriteria}
          onClose={() => setShowDecisionCriteria(false)}
          editable={false}
          mutate={() => {}}
        />
      )}
      {banner}
    </>
  );
}
