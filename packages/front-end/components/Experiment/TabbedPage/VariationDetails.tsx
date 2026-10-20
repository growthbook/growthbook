import { Box } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Heading from "@/ui/Heading";
import VariationsTable from "@/components/Experiment/VariationsTable";

export default function VariationDetails({
  experiment,
  canEdit,
  onEdit,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  canEdit: boolean;
  onEdit: (variationIndex: number) => void;
  mutate: () => void;
}) {
  return (
    <Box mt="5" mb="4">
      <Heading as="h4" size="sm" color="text-high" mb="3">
        Variation Summary
      </Heading>
      <VariationsTable
        experiment={experiment}
        canEditExperiment={canEdit}
        onEditMetadata={onEdit}
        mutate={mutate}
        showSplit={false}
        noMargin
        fill
      />
    </Box>
  );
}
