import { ReactNode } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import clsx from "clsx";
import { PiPencilSimple } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import styles from "./QuickEditButton.module.scss";

/** Put on whatever should reveal its quick-edit buttons on hover. */
export const revealsQuickEdit = styles.revealsEdit;

/** Put on any other action that waits for its `revealsQuickEdit` block. */
export const revealedByQuickEdit = styles.edit;

/**
 * Put on a framed block edited by clicking anywhere in it, beside
 * `revealsQuickEdit`; its `QuickEditButton` takes `fillsRow`.
 */
export const editsOnClick = styles.clickFrame;

/** A value edited by clicking anywhere on its row; read-only without `onEdit`. */
export function QuickEditRow({
  label,
  onEdit,
  align = "start",
  centered = false,
  children,
}: {
  label: string;
  onEdit?: (() => void) | null;
  align?: "start" | "center";
  // Wraps around its centre, the button spilling past the end so it doesn't
  // pull the content off centre.
  centered?: boolean;
  children: ReactNode;
}) {
  const button = onEdit ? (
    <QuickEditButton
      label={label}
      onClick={onEdit}
      labelTooltip={false}
      fillsRow
    />
  ) : null;
  return (
    <Flex
      align={align}
      justify={centered ? "center" : "between"}
      wrap={centered ? "wrap" : undefined}
      gap="3"
      className={onEdit ? clsx(styles.revealsEdit, styles.clickRow) : undefined}
    >
      {children}
      {button && centered ? (
        <span className={styles.spills}>{button}</span>
      ) : (
        button
      )}
    </Flex>
  );
}

export default function QuickEditButton({
  label,
  onClick,
  blockedReason,
  size = "1",
  labelTooltip = true,
  fillsRow = false,
  dimmed = false,
  inline = false,
}: {
  label: string;
  onClick: () => void;
  blockedReason?: string | null;
  size?: "1" | "2";
  // Off where what it edits is plain; a blocked reason still shows.
  labelTooltip?: boolean;
  // Clicked from anywhere in its `QuickEditRow` or `editsOnClick` block.
  fillsRow?: boolean;
  // Rests at half strength instead of hidden, where nothing reveals it.
  dimmed?: boolean;
  // Sits in a line of text without making it taller.
  inline?: boolean;
}) {
  return (
    <span className={clsx(styles.edit, dimmed && styles.dimmed)}>
      <Tooltip
        content={blockedReason ?? label}
        enabled={!!blockedReason || labelTooltip}
        // Why it can't be clicked shows wherever its row is pointed at.
        confineToTrigger={!blockedReason}
      >
        <IconButton
          type="button"
          size={size}
          variant="ghost"
          color="violet"
          radius="full"
          disabled={!!blockedReason}
          aria-label={label}
          className={fillsRow ? styles.rowTarget : undefined}
          style={inline ? undefined : { margin: 0 }}
          onClick={onClick}
        >
          <PiPencilSimple size={size === "2" ? 16 : 14} />
        </IconButton>
      </Tooltip>
    </span>
  );
}
