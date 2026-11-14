import { ReactNode, useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import Text from "@/ui/Text";
import styles from "./RevisionStatusBarView.module.scss";

// Room for a normal-sized button with even padding. A message that wraps
// grows it.
export const REVISION_STATUS_BAR_HEIGHT_PX = 48;

// Its message wraps, so what sticks beneath it reads its real height.
export function useRevisionStatusBarHeight(): [
  (el: HTMLDivElement | null) => void,
  number,
] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(REVISION_STATUS_BAR_HEIGHT_PX);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.borderBoxSize[0].blockSize),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, height];
}

/**
 * The viewed revision's state, fixed under the page's tabs: what it is, what
 * SDKs serve meanwhile, and what to do next.
 */
export default function RevisionStatusBarView({
  draft,
  icon,
  label,
  badge,
  message,
  actions,
  error = null,
}: {
  // Drafts are tinted amber, anything else gray.
  draft: boolean;
  icon: ReactNode;
  // Live needs no label: the message says what's pending.
  label: string | null;
  // Where the draft is in review, beside what it is.
  badge?: ReactNode;
  message: ReactNode;
  actions?: ReactNode;
  // Why an action failed, on a row of its own under them.
  error?: ReactNode;
}) {
  const tint = draft ? "amber" : "gray";
  return (
    <div
      className={styles.bar}
      style={{
        backgroundColor: `var(--${tint}-a3)`,
        // The tab row's underline, above it.
        boxShadow: "inset 0 1px 0 0 var(--gray-a5)",
      }}
    >
      <div
        // The header's page column, so the two line up.
        className={clsx(
          "container-fluid pagecontents",
          styles.row,
          error && styles.withError,
        )}
        style={{
          // Inset as the cards' content is below: the page gutter, a card's
          // padding, and a border as wide as the card's, which zoom rounds
          // the same way. Its actions end under the revision picker.
          paddingInline: "calc(2 * var(--space-5))",
          borderInline: "1px solid transparent",
          paddingBlock: "var(--space-2)",
          minHeight: REVISION_STATUS_BAR_HEIGHT_PX,
        }}
      >
        <Flex className={styles.status} align="center" gap="3">
          <Flex
            align="center"
            gap="1"
            flexShrink="0"
            style={{ color: `var(--${tint}-11)` }}
          >
            {icon}
            {label ? <Text weight="semibold">{label}</Text> : null}
          </Flex>
          {badge ? <Flex flexShrink="0">{badge}</Flex> : null}
        </Flex>
        <div className={styles.message}>
          <Text color="text-mid">{message}</Text>
        </div>
        {actions ? (
          <Flex className={styles.actions} align="center" gap="4">
            {actions}
          </Flex>
        ) : null}
        {error ? <div className={styles.error}>{error}</div> : null}
      </div>
    </div>
  );
}
