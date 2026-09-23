import { IconButton } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import styles from "./QuickEditButton.module.scss";

/** Put this class on whatever should reveal its quick-edit buttons on hover. */
export const revealsQuickEdit = styles.revealsEdit;

/**
 * The pencil that opens a single field's editor. Hidden until its surroundings
 * are hovered, and disabled with the reason while the page has edits pending.
 */
export default function QuickEditButton({
  label,
  onClick,
  blockedReason,
}: {
  label: string;
  onClick: () => void;
  blockedReason?: string | null;
}) {
  return (
    <span className={styles.edit}>
      <Tooltip content={blockedReason ?? label}>
        <IconButton
          size="1"
          variant="ghost"
          color="violet"
          radius="medium"
          disabled={!!blockedReason}
          aria-label={label}
          style={{ margin: 0 }}
          onClick={onClick}
        >
          <PiPencilSimple size={14} />
        </IconButton>
      </Tooltip>
    </span>
  );
}
