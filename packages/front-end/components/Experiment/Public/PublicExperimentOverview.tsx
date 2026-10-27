import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React from "react";
import { Box, Separator } from "@radix-ui/themes";
import Markdown from "@/components/Markdown/Markdown";
import VariationsTable from "@/components/Experiment/VariationsTable";
import AnalysisSettings from "@/components/Experiment/TabbedPage/AnalysisSettings";
import DecisionMakingSettings from "@/components/Experiment/TabbedPage/DecisionMakingSettings";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
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
  const hypothesis = experiment.hypothesis;

  return (
    <>
      {experiment.type !== "multi-armed-bandit" ? (
        <>
          <SetupFieldRow
            label="Hypothesis"
            labelSize="lg"
            content="text"
            labelAlign={hypothesis ? "top" : "center"}
          >
            {hypothesis ? (
              <Markdown
                isPublic
                shareUid={experiment.uid}
                shareType="experiment"
              >
                {hypothesis}
              </Markdown>
            ) : (
              <Text
                weight="regular"
                color="text-mid"
                size="md"
                fontStyle="italic"
              >
                No hypothesis
              </Text>
            )}
          </SetupFieldRow>
          <Separator size="4" my="2" />
        </>
      ) : null}

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
