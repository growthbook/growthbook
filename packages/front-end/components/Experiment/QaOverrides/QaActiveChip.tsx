import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import { groupQaOverrides } from "@/services/qaOverrides";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import useQaOverridePermissions from "./useQaOverridePermissions";
import { qaOverridesCountLabel } from "./QaOverridesStartNote";

export const QA_OVERRIDES_SECTION_ID = "qa-overrides";

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
        // Resets only what it must: `all: unset` would also remove the
        // keyboard focus ring.
        style={{
          display: "inline-flex",
          padding: 0,
          border: 0,
          background: "none",
          font: "inherit",
          color: "inherit",
          cursor: "pointer",
          borderRadius: 9999,
        }}
      >
        <Badge label="QA active" color="gray" variant="soft" radius="full" />
      </button>
    </Tooltip>
  );
}
