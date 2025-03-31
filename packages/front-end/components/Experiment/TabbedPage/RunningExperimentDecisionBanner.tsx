import Button from "@/components/Radix/Button";
import { Callout as RadixCallout } from "@radix-ui/themes";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import { Text, Flex, Box } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates, VariationWithIndex } from "back-end/types/experiment";
import { DEFAULT_DECISION_CRITERIA } from "shared/enterprise";
import ExperimentDecisionExplanation from "./ExperimentDecisionExplanation";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  editExperiment: () => void;
}

export default function RunningExperimentDecisionBanner({
  experiment,
  editExperiment,
}: Props) {
  const getRunningExperimentStatus = useRunningExperimentStatus();
  const runningExperimentStatus = getRunningExperimentStatus(experiment);

  // TODO resolver
  const decisionCriteria = experiment.decisionCriteria ?? DEFAULT_DECISION_CRITERIA;

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
  ) return null;

  const winningVariations: VariationWithIndex[] = runningExperimentStatus.variationIds.map(
    (id) => indexedVariations.find((v) => v.id === id)
  ).filter((v) => v !== undefined); // TODO deal with missing variaitons better
  


  const variationNames = winningVariations.map((v) => {
    return (
       <div
      className={`variation variation${v.index} with-variation-label d-flex align-items-center`}
    >
      <span
        className="label"
        style={{ width: 20, height: 20, flex: "none" }}
      >
        {v.index}
      </span>
      <span
        className="d-inline-block"
      >
        {v.name}
      </span>
    </div>)
  });
  if (winningVariations.length === 0) return null; // TODO



  if (winningVariations.length === 1) {
    return <div className="appbox p-3">
      <Flex direction="column" gap="2">
        <Flex direction="row" align="center" justify="between">
          <Box>
            <Flex direction="row">
              {variationNames[0]}<Text ml="1"> is ready to ship.</Text>
            </Flex>
          </Box>
          <Box>
            <Button variant="solid" onClick={editExperiment}>
              Ship It
            </Button>
          </Box>
        </Flex>
        <ExperimentDecisionExplanation 
          experiment={experiment} 
          status={runningExperimentStatus} 
        />
      </Flex>
      </div>;
  }
  return null;
}
