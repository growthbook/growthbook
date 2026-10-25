import { IconButton } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import styles from "./QuickEditButton.module.scss";

/** Put on whatever should reveal its quick-edit buttons on hover. */
export const revealsQuickEdit = styles.revealsEdit;

export default function QuickEditButton({
  label,
  onClick,
  blockedReason,
  size = "1",
  labelTooltip = true,
}: {
  label: string;
  onClick: () => void;
  blockedReason?: string | null;
  size?: "1" | "2";
  // Off where what it edits is plain; a blocked reason still shows.
  labelTooltip?: boolean;
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
          style={{ margin: 0 }}
          onClick={onClick}
        >
          <PiPencilSimple size={size === "2" ? 16 : 14} />
        </IconButton>
      </Tooltip>
    </span>
  );
}
