import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React from "react";
import { Box, Separator } from "@radix-ui/themes";
import Markdown from "@/components/Markdown/Markdown";
import VariationsTable from "@/components/Experiment/VariationsTable";
import AnalysisSettings from "@/components/Experiment/TabbedPage/AnalysisSettings";
import DecisionMakingSettings from "@/components/Experiment/TabbedPage/DecisionMakingSettings";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import ExpandableBlock from "@/components/Experiment/TabbedPage/ExpandableBlock";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

export default function PublicExperimentOverview({
  experiment,
  ssrPolyfills,
}: {
  experiment: ExperimentInterfaceStringDates;
  ssrPolyfills: SSRPolyfills;
}) {
  // As on the experiment's Setup tab: a Bandit has no hypothesis, and a long
  // description is clamped.
  const textRow = (label: string, value: string | undefined) => {
    const body = (
      <Markdown isPublic shareUid={experiment.uid} shareType="experiment">
        {value}
      </Markdown>
    );
    return (
      <>
        <SetupFieldRow
          label={label}
          labelSize="lg"
          content="text"
          labelAlign={value ? "top" : "center"}
        >
          {!value ? (
            <Text
              weight="regular"
              color="text-mid"
              size="md"
              fontStyle="italic"
            >
              No {label.toLowerCase()}
            </Text>
          ) : label === "Description" ? (
            <ExpandableBlock>{body}</ExpandableBlock>
          ) : (
            body
          )}
        </SetupFieldRow>
        <Separator size="4" my="2" />
      </>
    );
  };

  return (
    <>
      {experiment.type !== "multi-armed-bandit"
        ? textRow("Hypothesis", experiment.hypothesis)
        : null}
      {textRow("Description", experiment.description)}

      <Box my="4">
        <Heading as="h4" size="sm" color="text-high" mb="3">
          Variations
        </Heading>
        <VariationsTable
          experiment={experiment}
          canEditExperiment={false}
          isPublic
          shareUid={experiment.uid}
          shareType="experiment"
          noMargin
          fill
        />
      </Box>

      <AnalysisSettings
        experiment={experiment}
        envs={[]}
        canEdit={false}
        ssrPolyfills={ssrPolyfills}
        isPublic
      />
      <DecisionMakingSettings
        experiment={experiment}
        ssrPolyfills={ssrPolyfills}
      />
    </>
  );
}
