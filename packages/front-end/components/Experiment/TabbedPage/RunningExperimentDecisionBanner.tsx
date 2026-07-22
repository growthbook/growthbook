import { Text, Flex, Box } from "@radix-ui/themes";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
  VariationWithIndex,
} from "shared/types/experiment";
import { useState } from "react";
import { BsLightningFill } from "react-icons/bs";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import {
  buildTiebreakerLiftMap,
  resolveScheduledShipDecision,
} from "shared/enterprise";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import Link from "@/ui/Link";
import VariationLabel from "@/ui/VariationLabel";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import ExperimentDecisionExplanation from "./ExperimentDecisionExplanation";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus: ExperimentResultStatusData;
  decisionCriteria: DecisionCriteriaData;
  showDecisionCriteriaLink?: boolean;
}

export default function RunningExperimentDecisionBanner({
  experiment,
  runningExperimentStatus,
  decisionCriteria,
  showDecisionCriteriaLink = true,
}: Props) {
  const [showDecisionCriteria, setShowDecisionCriteria] = useState(false);
  const { snapshot, analysis } = useSnapshot();
  const { getExperimentMetricById } = useDefinitions();

  const variations = getLatestPhaseVariations(experiment);
  const indexedVariations = variations.map<VariationWithIndex>((v, i) => ({
    ...v,
    index: i,
  }));

  if (
    runningExperimentStatus.status !== "ship-now" &&
    runningExperimentStatus.status !== "ready-for-review" &&
    runningExperimentStatus.status !== "rollback-now"
  )
    return null;

  const decidedVariations: VariationWithIndex[] =
    runningExperimentStatus.variations
      .map(({ variationId }) =>
        indexedVariations.find((v) => v.id === variationId),
      )
      .filter((v) => v !== undefined);

  const variationNames: Record<string, JSX.Element> = {};
  variations.forEach((v) => {
    variationNames[v.id] = <VariationLabel number={v.index} name={v.name} />;
  });
  if (decidedVariations.length === 0) return null;

  // An ambiguous multi-winner ship is resolved at the scheduled end by the
  // tiebreaker metric. Surface that here so it's visible before the end date.
  const tiebreakerMetricId = experiment.scheduledStopPlan?.tiebreakerMetricId;
  const isShipTie =
    runningExperimentStatus.status === "ship-now" &&
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

  const tiebreakerLine = isShipTie ? (
    <Flex direction="row" align="center" gap="1">
      <Text size="1" className="text-muted">
        Ties will be broken by {tiebreakerMetricName}
        {tiebreakerWinnerId && variationNames[tiebreakerWinnerId] ? ":" : "…"}
      </Text>
      {tiebreakerWinnerId && variationNames[tiebreakerWinnerId] ? (
        <Box>{variationNames[tiebreakerWinnerId]}</Box>
      ) : null}
    </Flex>
  ) : null;

  let decisionContent: JSX.Element | null = null;
  if (runningExperimentStatus.status === "ship-now") {
    decisionContent = (
      <>
        <BsLightningFill className="mx-1 text-success" />
        <Text weight="bold">Ship now:</Text>
      </>
    );
  } else if (runningExperimentStatus.status === "ready-for-review") {
    decisionContent = (
      <>
        <BsLightningFill className="mx-1 text-warning" />
        <Text weight="bold">Ready for review:</Text>
      </>
    );
  } else if (runningExperimentStatus.status === "rollback-now") {
    decisionContent = (
      <>
        <BsLightningFill className="mx-1 text-danger" />
        <Text weight="bold">Rollback now:</Text>
      </>
    );
  }

  const banner = decisionContent && (
    <div className="appbox p-3">
      <Box>
        <Collapsible
          trigger={
            <Flex direction="row" align="center" justify="between">
              <Box>
                <Flex direction="row" align="center">
                  {decisionContent}
                  <Flex direction="row" align="center" gap="1" ml="2">
                    {decidedVariations.map((v, i) => (
                      <>
                        <Box key={v.id}>{variationNames[v.id]}</Box>
                        {i !== decidedVariations.length - 1 ? (
                          <Text mx="1">,</Text>
                        ) : null}
                      </>
                    ))}
                  </Flex>
                </Flex>
                {tiebreakerLine ? <Box mt="1">{tiebreakerLine}</Box> : null}
              </Box>
              <Link>
                View Details
                <FaAngleRight className="chevron ml-1" />
              </Link>
            </Flex>
          }
          transitionTime={100}
        >
          <>
            <hr className="mt-3" />
            <ExperimentDecisionExplanation
              status={runningExperimentStatus}
              variations={runningExperimentStatus.variations}
              variationNames={variationNames}
              showDecisionCriteria={showDecisionCriteria}
              setShowDecisionCriteria={setShowDecisionCriteria}
              showDecisionCriteriaLink={showDecisionCriteriaLink}
            />
          </>
        </Collapsible>
      </Box>
    </div>
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
