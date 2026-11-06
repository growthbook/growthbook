import { CSSProperties } from "react";
import { IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import Tooltip from "@/ui/Tooltip";

// Why a lock-edits schedule disables a draft's controls.
export const SCHEDULE_EDIT_LOCK_REASON =
  "Locked for a scheduled publish. Cancel the schedule to edit.";

/** A row's actions menu, disabled while its draft is locked. */
export function LockedRowMenu({
  iconSize = 16,
  style = { margin: 0 },
}: {
  iconSize?: number;
  style?: CSSProperties;
}) {
  return (
    <Tooltip content={SCHEDULE_EDIT_LOCK_REASON}>
      <IconButton
        variant="ghost"
        color="gray"
        radius="full"
        size="2"
        highContrast
        disabled
        aria-label="Actions"
        style={style}
      >
        <BsThreeDotsVertical size={iconSize} />
      </IconButton>
    </Tooltip>
  );
}
