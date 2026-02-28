import { Flex } from "@radix-ui/themes";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";

export default function ExperimentStatusIndicatorStories() {
  return (
    <Flex gap="3" wrap="wrap">
      <ExperimentStatusIndicator
        experimentData={{
          archived: false,
          status: "draft",
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
