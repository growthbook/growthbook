import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useQaOverrideCount } from "@/hooks/useExperimentQaOverrides";
import { qaOverridesCountLabel } from "@/services/qaOverrides";
import Text from "@/ui/Text";

export default function QaOverridesStartNote({
  experiment,
  mt,
}: {
  experiment: Pick<ExperimentInterfaceStringDates, "id" | "name" | "status">;
  mt?: "1" | "2" | "3" | "4";
}) {
  const count = useQaOverrideCount(experiment);
  if (!count) return null;
  return (
    <Text as="p" size="sm" color="text-mid" mt={mt} mb="0">
      Starting {experiment.name} deletes its {qaOverridesCountLabel(count)}.
    </Text>
  );
}
