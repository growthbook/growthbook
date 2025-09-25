import { Flex } from "@radix-ui/themes";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";

export default function ExperimentResultIndicatorStories() {
  return (
    <Flex gap="3">
      <ResultsIndicator results="dnf" />
      <ResultsIndicator results="inconclusive" />
      <ResultsIndicator results="won" />
      <ResultsIndicator results="lost" />
    </Flex>
  );
}
