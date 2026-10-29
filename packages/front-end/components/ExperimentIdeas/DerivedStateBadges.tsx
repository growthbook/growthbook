import { Flex } from "@radix-ui/themes";
import { ExperimentIdeaDerivedState } from "shared/validators";
import Badge from "@/ui/Badge";
import { DERIVED_STATE_LABELS } from "./constants";

export default function DerivedStateBadges({
  states,
  archived,
  linkedExperimentCount,
}: {
  states: ExperimentIdeaDerivedState[];
  archived?: boolean;
  linkedExperimentCount?: number;
}) {
  if (!states.length && !archived) return null;
  return (
    <Flex gap="1" wrap="wrap">
      {archived && (
        <Badge label="Archived" color="gray" variant="soft" size="xs" />
      )}
      {states.map((s) => {
        const { label, color } = DERIVED_STATE_LABELS[s];
        const showCount = s === "converted" && (linkedExperimentCount ?? 0) > 1;
        return (
          <Badge
            key={s}
            label={showCount ? `${label} · ${linkedExperimentCount}` : label}
            color={color}
            variant="soft"
            size="xs"
          />
        );
      })}
    </Flex>
  );
}
