import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import { groupQaOverrides } from "@/services/qaOverrides";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import useQaOverridePermissions from "./useQaOverridePermissions";
import { qaOverridesCountLabel } from "./QaOverridesStartNote";

// The id the chip scrolls to; set on the QA Overrides card.
export const QA_OVERRIDES_SECTION_ID = "qa-overrides";

/**
 * "QA active" next to a draft's status while it has QA overrides. The status
 * itself stays Draft. Hovering says how many and where; clicking goes to the
 * QA Overrides card.
 */
export default function QaActiveChip({
  experiment,
  onClick,
}: {
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "id" | "status" | "archived" | "project"
  >;
  onClick: () => void;
}) {
  // Only drafts can have QA overrides.
  const isDraft = experiment.status === "draft" && !experiment.archived;
  const { data } = useExperimentQaOverrides(
    isDraft ? experiment.id : undefined,
  );
  const { environmentOrder } = useQaOverridePermissions(experiment);
  const overrides = data?.overrides ?? [];
  if (!isDraft || !overrides.length) return null;

  const perEnvironment = groupQaOverrides(overrides, environmentOrder)
    .map((g) => `${g.environment} (${g.rows.length})`)
    .join(", ");
  return (
    <Tooltip
      content={`${qaOverridesCountLabel(overrides.length)}: ${perEnvironment}`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label="QA active. Go to QA Overrides"
        style={{
          all: "unset",
          display: "inline-flex",
          cursor: "pointer",
          borderRadius: 9999,
        }}
      >
        <Badge label="QA active" color="gray" variant="soft" radius="full" />
      </button>
    </Tooltip>
  );
}
