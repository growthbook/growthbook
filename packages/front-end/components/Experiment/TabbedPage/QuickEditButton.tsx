import { ReactNode } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import clsx from "clsx";
import { PiPencilSimple } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import styles from "./QuickEditButton.module.scss";

/** Put on whatever should reveal its quick-edit buttons on hover. */
export const revealsQuickEdit = styles.revealsEdit;

/** A value edited by clicking anywhere on its row; read-only without `onEdit`. */
export function QuickEditRow({
  label,
  onEdit,
  align = "start",
  children,
}: {
  label: string;
  onEdit?: (() => void) | null;
  align?: "start" | "center";
  children: ReactNode;
}) {
  return (
    <Flex
      align={align}
      justify="between"
      gap="3"
      className={onEdit ? clsx(styles.revealsEdit, styles.clickRow) : undefined}
    >
      {children}
      {onEdit ? (
        <QuickEditButton
          label={label}
          onClick={onEdit}
          labelTooltip={false}
          fillsRow
        />
      ) : null}
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
}: {
  label: string;
  onClick: () => void;
  blockedReason?: string | null;
  size?: "1" | "2";
  // Off where what it edits is plain; a blocked reason still shows.
  labelTooltip?: boolean;
  // Clicked from anywhere in its `QuickEditRow`.
  fillsRow?: boolean;
}) {
  return (
    <span className={styles.edit}>
      <Tooltip
        content={blockedReason ?? label}
        enabled={!!blockedReason || labelTooltip}
        // Why it can't be clicked shows wherever its row is pointed at.
        confineToTrigger={!blockedReason}
      >
        <IconButton
          size={size}
          variant="ghost"
          color="violet"
          radius={size === "2" ? "full" : "medium"}
          disabled={!!blockedReason}
          aria-label={label}
          className={fillsRow ? styles.rowTarget : undefined}
          style={{ margin: 0 }}
          onClick={onClick}
        >
          <PiPencilSimple size={size === "2" ? 16 : 14} />
        </IconButton>
      </Tooltip>
    </span>
  );
}
