import { Flex } from "@radix-ui/themes";
import { StoryMeta } from "@/ui/storyMeta";
import { ProgressBar } from "./ProgressBar";

export const meta: StoryMeta = {
  name: "ProgressBar",
  category: "feedback",
  status: "stable",
  summary:
    "A segmented bar where each segment has its own weight, completion, color, and tooltip.",
  useWhen: [
    "Show progress across several weighted stages.",
    "Show partial completion of a single run.",
  ],
  avoidWhen: [
    {
      reason: "You need step-by-step navigation through a flow.",
      use: "Stepper",
    },
  ],
  related: ["Stepper"],
};

export default function ProgressBarStories() {
  return (
    <Flex direction="column" gap="3">
      <ProgressBar
        segments={[{ id: "1", weight: 100, completion: 0, color: "indigo" }]}
      />
      <ProgressBar
        segments={[{ id: "1", weight: 100, completion: 70, color: "indigo" }]}
      />
      <ProgressBar
        segments={[{ id: "1", weight: 80, completion: 70, color: "indigo" }]}
      />
      <ProgressBar
        segments={[
          {
            id: "1",
            weight: 50,
            completion: 70,
            color: "indigo",
            endBorder: true,
          },
          { id: "2", weight: 50, completion: 0, color: "amber" },
        ]}
      />
      <ProgressBar
        segments={[
          {
            id: "1",
            weight: 50,
            completion: 100,
            color: "indigo",
            endBorder: true,
          },
          { id: "2", weight: 50, completion: 30, color: "amber" },
        ]}
      />
      <ProgressBar
        segments={[
          {
            id: "1",
            weight: 20,
            completion: 0,
            color: "slate",
          },
          { id: "2", weight: 20, completion: 100, color: "purple" },
          { id: "3", weight: 20, completion: 0, color: "slate" },
          { id: "4", weight: 20, completion: 100, color: "indigo" },
          { id: "5", weight: 20, completion: 0, color: "slate" },
        ]}
      />
    </Flex>
  );
}
