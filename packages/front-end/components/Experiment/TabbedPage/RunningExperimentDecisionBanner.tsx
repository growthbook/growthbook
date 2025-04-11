import { Text, Flex, Box } from "@radix-ui/themes";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
  VariationWithIndex,
} from "back-end/types/experiment";
import { useState } from "react";
import Link from "@/components/Radix/Link";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import ExperimentDecisionExplanation from "./ExperimentDecisionExplanation";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus: ExperimentResultStatusData;
  decisionCriteria: DecisionCriteriaData;
}

export default function RunningExperimentDecisionBanner({
  experiment,
  runningExperimentStatus,
  decisionCriteria,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [showDecisionCriteria, setShowDecisionCriteria] = useState(false);
  // TODO resolver

  const variations = experiment.variations;
  const indexedVariations = variations.map<VariationWithIndex>((v, i) => ({
    ...v,
    index: i,
  }));

  if (!runningExperimentStatus) return null;

  if (
    runningExperimentStatus.status !== "ship-now" &&
    runningExperimentStatus.status !== "ready-for-review" &&
    runningExperimentStatus.status !== "rollback-now"
  )
    return null;

  const decidedVariations: VariationWithIndex[] = runningExperimentStatus.variations
    .map(({ variationId }) =>
      indexedVariations.find((v) => v.id === variationId)
    )
    .filter((v) => v !== undefined); // TODO deal with missing variations better

  const variationNames: Record<string, JSX.Element> = {};
  variations.forEach((v, i) => {
    variationNames[v.id] = (
      <Flex
        direction="row"
        className={`variation variation${i} with-variation-label d-flex align-items-center`}
      >
        <span
          className="label"
          style={{ width: 20, height: 20, flex: "none", marginRight: 4 }}
        >
          {i}
        </span>
        <span className="d-inline-block">{v.name}</span>
      </Flex>
    );
  });
  if (decidedVariations.length === 0) return null; // TODO

  let content: JSX.Element | null = null;
  let status: "success" | "warning" | "danger" = "warning";

  if (runningExperimentStatus.status === "ship-now") {
    content = (
      <>
        {decidedVariations.length === 1 ? (
          <>
            {variationNames[decidedVariations[0].id]}
            <Text ml="1" mr="2">
              {" "}
              is ready to ship.
            </Text>
          </>
        ) : (
          <>
            <Flex direction="row" gap="1">
              {decidedVariations.map((v, i) => (
                <>
                  <Box key={v.id}>{variationNames[v.id]}</Box>
                  {i !== decidedVariations.length - 1 ? <Text>&</Text> : null}
                </>
              ))}
            </Flex>
            <Text ml="1" mr="2">
              {" "}
              are ready to ship.
            </Text>
          </>
        )}
      </>
    );
    status = "success";
  } else if (runningExperimentStatus.status === "ready-for-review") {
    content = (
      <>
        {decidedVariations.length === 1 ? (
          <>
            {variationNames[decidedVariations[0].id]}
            <Text ml="1" mr="2">
              {" "}
              is ready for a decision, but results require review.
            </Text>
          </>
        ) : (
          <>
            <Flex direction="row" gap="1">
              {decidedVariations.map((v, i) => (
                <>
                  <Box key={v.id}>{variationNames[v.id]}</Box>
                  {i !== decidedVariations.length - 1 ? <Text>&</Text> : null}
                </>
              ))}
            </Flex>
            <Text ml="1" mr="2">
              {" "}
              are ready for a decision, but results require review.
            </Text>
          </>
        )}
      </>
    );
    status = "warning";
  } else if (runningExperimentStatus.status === "rollback-now") {
    content = (
      <>
        {decidedVariations.length === 1 ? (
          <>
            {variationNames[decidedVariations[0].id]}
            <Text ml="1" mr="2">
              {" "}
              should be rolled back.
            </Text>
          </>
        ) : (
          <Text>All variations should be rolled back.</Text>
        )}
      </>
    );
    status = "danger";
  }

  const banner = content && (
    <div className={`alert alert-${status}`}>
      <Box>
        <Flex direction="column" gap="2">
          <Flex direction="row" align="center" justify="between">
            <Box>
              <Flex direction="row">
                {content}
                <Link onClick={() => setShowDetails(!showDetails)}>
                  View Details
                </Link>
              </Flex>
            </Box>
          </Flex>
          {showDetails && (
            <ExperimentDecisionExplanation
              status={runningExperimentStatus}
              variations={runningExperimentStatus.variations}
              variationNames={variationNames}
              showDecisionCriteria={showDecisionCriteria}
              setShowDecisionCriteria={setShowDecisionCriteria}
            />
          )}
        </Flex>
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
