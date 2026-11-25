import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import clsx from "clsx";
import useBottomBarClearance from "@/hooks/useBottomBarClearance";
import Button from "@/ui/Button";
import styles from "./StagedEditsBar.module.scss";

export const EDITS_BLOCKED_REASON = "Save or discard your changes first.";

/** Appears once something on the page is edited, and is the only way to write it. */
export default function StagedEditsBar({
  changes,
  notes,
  target,
  saving,
  saveDisabled = false,
  pinned = false,
  onDiscard,
  onSave,
}: {
  // What's unsaved: StagedChangesPopover's list, or a label when nothing can
  // be listed apart (something new, or edits that rewrite each other).
  changes: ReactNode;
  // Warnings and errors, beside the buttons.
  notes?: ReactNode;
  // Where Save writes, before the buttons.
  target?: ReactNode;
  saving: boolean;
  saveDisabled?: boolean;
  // On Settings pages: pinned to the window's bottom, across the Settings nav.
  pinned?: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const barRef = useBottomBarClearance<HTMLDivElement>();
  return (
    <>
      {/* Room for the pinned bar under the page's last item. */}
      {pinned && <div className={styles.pinnedSpacer} />}
      <div
        ref={barRef}
        className={clsx(styles.bar, pinned && styles.pinned)}
        role="region"
        aria-label="Unsaved changes"
      >
        <Flex align="center" gap="3">
          {changes}
          <Box flexGrow="1" />
          {/* Set apart from the controls it sits beside. */}
          <Flex align="center" gap="3" mr="3">
            {notes}
          </Flex>
          {target ? <Box mr="3">{target}</Box> : null}
          <Button
            variant="ghost"
            color="gray"
            disabled={saving}
            onClick={onDiscard}
          >
            Discard changes
          </Button>
          <Button disabled={saving || saveDisabled} onClick={onSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </Flex>
      </div>
    </>
  );
}
