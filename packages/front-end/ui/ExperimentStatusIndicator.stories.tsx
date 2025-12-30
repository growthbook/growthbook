import { Flex } from "@radix-ui/themes";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";

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
