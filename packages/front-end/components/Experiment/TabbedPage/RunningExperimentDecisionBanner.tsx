import { Text, Flex, Box } from "@radix-ui/themes";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
  VariationWithIndex,
} from "shared/types/experiment";

/** Banner + explanation only use decision-framework statuses that carry `variations`. */
type RunningDecisionExperimentStatus = Extract<
  ExperimentResultStatusData,
  | { status: "ship-now" }
  | { status: "rollback-now" }
  | { status: "ready-for-review" }
>;
import { useState } from "react";
import { BsLightningFill } from "react-icons/bs";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import Link from "@/ui/Link";
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

  const variations = getLatestPhaseVariations(experiment);
  const indexedVariations = variations.map<VariationWithIndex>((v, i) => ({
    ...v,
    index: i,
  }));

  const status = runningExperimentStatus.status;
  const isDecisionBannerStatus =
    status === "ship-now" ||
    status === "ready-for-review" ||
    status === "rollback-now";

  if (!isDecisionBannerStatus) return null;

  const frameworkVariations = (
    runningExperimentStatus as RunningDecisionExperimentStatus
  ).variations;

  const decidedVariations: VariationWithIndex[] = frameworkVariations
    .map(({ variationId }) =>
      indexedVariations.find((v) => v.id === variationId),
    )
    .filter((v) => v !== undefined);

  const variationNames: Record<string, JSX.Element> = {};
  variations.forEach((v) => {
    variationNames[v.id] = (
      <Flex
        direction="row"
        className={`variation variation${v.index} with-variation-label d-flex align-items-center`}
      >
        <span
          className="label"
          style={{ width: 20, height: 20, flex: "none", marginRight: 4 }}
        >
          {v.index}
        </span>
        <span className="d-inline-block">{v.name}</span>
      </Flex>
    );
  });
  if (decidedVariations.length === 0) return null;

  let decisionContent: JSX.Element | null = null;
  if (status === "ship-now") {
    decisionContent = (
      <>
        <BsLightningFill className="mx-1 text-success" />
        <Text weight="bold">Ship now:</Text>
      </>
    );
  } else if (status === "ready-for-review") {
    decisionContent = (
      <>
        <BsLightningFill className="mx-1 text-warning" />
        <Text weight="bold">Ready for review:</Text>
      </>
    );
  } else if (status === "rollback-now") {
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
                  <Flex direction="row" gap="1" ml="2">
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
              experiment={experiment}
              status={runningExperimentStatus}
              variations={frameworkVariations}
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
