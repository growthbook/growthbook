import { Flex } from "@radix-ui/themes";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "ExperimentResultIndicator",
  category: "experimentation",
  status: "stable",
  summary:
    "Badge for an experiment's outcome: won, lost, inconclusive, or did not finish.",
  useWhen: ["Showing a concluded experiment's result in lists or headers."],
  avoidWhen: [
    {
      reason: "Showing whether the experiment is running or stopped.",
      use: "ExperimentStatusIndicator",
    },
  ],
  related: ["ExperimentStatusIndicator"],
};

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
