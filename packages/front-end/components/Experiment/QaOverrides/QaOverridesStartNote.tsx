import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import Text from "@/ui/Text";

export const qaOverridesCountLabel = (count: number) =>
  count === 1 ? "1 QA override" : `${count} QA overrides`;

/**
 * "Starting <name> deletes its 3 QA overrides." for places that start a
 * draft experiment from somewhere other than its own page. Renders nothing
 * when there are none.
 */
export default function QaOverridesStartNote({
  experiment,
  mt,
}: {
  experiment: Pick<ExperimentInterfaceStringDates, "id" | "name" | "status">;
  mt?: "1" | "2" | "3" | "4";
}) {
  // Only drafts can have QA overrides.
  const { data } = useExperimentQaOverrides(
    experiment.status === "draft" ? experiment.id : undefined,
  );
  const count = data?.overrides.length ?? 0;
  if (!count) return null;
  return (
    <Text as="p" size="sm" color="text-mid" mt={mt} mb="0">
      Starting {experiment.name} deletes its {qaOverridesCountLabel(count)}.
    </Text>
  );
}
