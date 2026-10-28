import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React from "react";
import { Box, Separator } from "@radix-ui/themes";
import VariationsTable from "@/components/Experiment/VariationsTable";
import AnalysisSettings from "@/components/Experiment/TabbedPage/AnalysisSettings";
import DecisionMakingSettings from "@/components/Experiment/TabbedPage/DecisionMakingSettings";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import ExperimentTextValue, {
  EXPERIMENT_TEXT_FIELDS,
  ExperimentTextFieldKey,
} from "@/components/Experiment/TabbedPage/ExperimentTextValue";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Heading from "@/ui/Heading";

export default function PublicExperimentOverview({
  experiment,
  ssrPolyfills,
}: {
  experiment: ExperimentInterfaceStringDates;
  ssrPolyfills: SSRPolyfills;
}) {
  // As on the experiment's Setup tab, where a Bandit has no hypothesis.
  const textRow = (
    field: ExperimentTextFieldKey,
    value: string | undefined,
  ) => (
    <>
      <SetupFieldRow
        label={EXPERIMENT_TEXT_FIELDS[field].label}
        labelSize="lg"
        content="text"
        labelAlign={value ? "top" : "center"}
      >
        <ExperimentTextValue
          field={field}
          value={value || ""}
          shareUid={experiment.uid}
        />
      </SetupFieldRow>
      <Separator size="4" my="2" />
    </>
  );

  return (
    <>
      {experiment.type !== "multi-armed-bandit"
        ? textRow("hypothesis", experiment.hypothesis)
        : null}
      {textRow("description", experiment.description)}

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
