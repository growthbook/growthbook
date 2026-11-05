import { Flex } from "@radix-ui/themes";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "ExperimentStatusIndicator",
  category: "experimentation",
  status: "stable",
  summary:
    "Badge for an experiment's lifecycle status, such as draft, running, or stopped.",
  useWhen: ["Showing where an experiment is in its lifecycle."],
  avoidWhen: [
    {
      reason: "Showing the final result.",
      use: "ExperimentResultIndicator",
    },
  ],
  related: ["ExperimentResultIndicator"],
};

export default function ExperimentStatusIndicatorStories() {
  return (
    <Flex gap="3" wrap="wrap">
      <ExperimentStatusIndicator
        experimentData={{
          archived: false,
          status: "draft",
          variations: [],
          phases: [],
          goalMetrics: [],
          guardrailMetrics: [],
          secondaryMetrics: [],
          datasource: "ds_abc123",
          decisionFrameworkSettings: {},
        }}
      />
      <ExperimentStatusIndicator
        experimentData={{
          archived: false,
          status: "running",
          variations: [],
          phases: [],
          goalMetrics: [],
          guardrailMetrics: [],
          secondaryMetrics: [],
          datasource: "ds_abc123",
          decisionFrameworkSettings: {},
        }}
      />
      <ExperimentStatusIndicator
        experimentData={{
          archived: false,
          status: "stopped",
          variations: [],
          phases: [],
          goalMetrics: [],
          guardrailMetrics: [],
          secondaryMetrics: [],
          datasource: "ds_abc123",
          decisionFrameworkSettings: {},
        }}
      />
      <ExperimentStatusIndicator
        experimentData={{
          archived: false,
          status: "stopped",
          results: "dnf",
          variations: [],
          phases: [],
          goalMetrics: [],
          guardrailMetrics: [],
          secondaryMetrics: [],
          datasource: "ds_abc123",
          decisionFrameworkSettings: {},
        }}
      />
      <ExperimentStatusIndicator
        experimentData={{
          archived: false,
          status: "stopped",
          results: "inconclusive",
          variations: [],
          phases: [],
          goalMetrics: [],
          guardrailMetrics: [],
          secondaryMetrics: [],
          datasource: "ds_abc123",
          decisionFrameworkSettings: {},
        }}
      />
      <ExperimentStatusIndicator
        experimentData={{
          archived: false,
          status: "stopped",
          results: "won",
          variations: [],
          phases: [],
          goalMetrics: [],
          guardrailMetrics: [],
          secondaryMetrics: [],
          datasource: "ds_abc123",
          decisionFrameworkSettings: {},
        }}
      />
      <ExperimentStatusIndicator
        experimentData={{
          archived: false,
          status: "stopped",
          results: "lost",
          variations: [],
          phases: [],
          goalMetrics: [],
          guardrailMetrics: [],
          secondaryMetrics: [],
          datasource: "ds_abc123",
          decisionFrameworkSettings: {},
        }}
      />
      <ExperimentStatusIndicator
        experimentData={{
          archived: true,
          status: "running",
          variations: [],
          phases: [],
          goalMetrics: [],
          guardrailMetrics: [],
          secondaryMetrics: [],
          datasource: "ds_abc123",
          decisionFrameworkSettings: {},
        }}
      />
    </Flex>
  );
}
