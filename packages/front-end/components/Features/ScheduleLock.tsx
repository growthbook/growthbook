import { CSSProperties } from "react";
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
  return (
    <Tooltip content={SCHEDULE_EDIT_LOCK_REASON}>
      <MoreMenuTrigger
        label="Actions"
        disabled
        className={className}
        style={style}
      />
    </Tooltip>
  );
}
