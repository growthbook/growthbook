import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import useBottomBarClearance from "@/hooks/useBottomBarClearance";
import Button from "@/ui/Button";
import styles from "./StagedEditsBar.module.scss";

/** Appears once something on the page is edited, and is the only way to write it. */
export default function StagedEditsBar({
  columnClassName,
  changes,
  notes,
  target,
  saving,
  saveDisabled = false,
  onDiscard,
  onSave,
}: {
  // The page column it lines up with.
  columnClassName: string;
  // What's staged, opened from its count.
  changes: ReactNode;
  // Warnings and errors, beside the buttons.
  notes?: ReactNode;
  // Where Save writes, before the buttons.
  target?: ReactNode;
  saving: boolean;
  saveDisabled?: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const barRef = useBottomBarClearance<HTMLDivElement>();
  return (
    <div ref={barRef} className={styles.bar}>
      <Box
        mx="auto"
        width="100%"
        className={columnClassName}
        style={{ maxWidth: "var(--page-content-max-width)" }}
      >
        <Flex align="center" gap="3">
          {changes}
          <Box flexGrow="1" />
          {notes}
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
      </Box>
    </div>
  );
}
