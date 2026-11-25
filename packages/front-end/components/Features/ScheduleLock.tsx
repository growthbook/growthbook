import { CSSProperties } from "react";
import { useLingui } from "@lingui/react/macro";
import { MoreMenuTrigger } from "@/ui/DropdownMenu";
import Tooltip from "@/ui/Tooltip";

// Why a lock-edits schedule disables a draft's controls.
export const SCHEDULE_EDIT_LOCK_REASON =
  "Locked for a scheduled publish. Cancel the schedule to edit.";

/** A row's actions menu, disabled while its draft is locked. */
export function LockedRowMenu({
  style,
  className,
}: {
  style?: CSSProperties;
  className?: string;
}) {
  const { t } = useLingui();
  return (
    <Tooltip content={SCHEDULE_EDIT_LOCK_REASON}>
      <MoreMenuTrigger
        label={t`Actions`}
        disabled
        className={className}
        style={style}
      />
    </Tooltip>
  );
}
