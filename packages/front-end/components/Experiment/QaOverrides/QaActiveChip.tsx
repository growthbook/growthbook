import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import {
  groupQaOverrides,
  qaOverridesCountLabel,
} from "@/services/qaOverrides";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import useQaOverridePermissions from "./useQaOverridePermissions";

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
  const { data } = useExperimentQaOverrides(experiment);
  const { environmentOrder } = useQaOverridePermissions(experiment);
  const overrides = data?.overrides ?? [];
  if (!overrides.length) return null;

  const perEnvironment = groupQaOverrides(overrides, environmentOrder)
    .map((g) => `${g.environment} (${g.rows.length})`)
    .join(", ");
  return (
    <Tooltip
      content={`${qaOverridesCountLabel(overrides.length)}: ${perEnvironment}`}
    >
      <Link
        color="inherit"
        underline="none"
        onClick={onClick}
        aria-label="QA active. Go to QA Overrides"
      >
        <Badge label="QA active" color="gray" variant="soft" radius="full" />
      </Link>
    </Tooltip>
  );
}
