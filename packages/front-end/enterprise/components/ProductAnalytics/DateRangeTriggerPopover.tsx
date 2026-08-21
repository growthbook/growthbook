import { ReactNode } from "react";
import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
import { PiCalendarBlank, PiCaretDown } from "react-icons/pi";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import styles from "./DateRangeCompareDropdown.module.scss";

/** What follows "vs" on the trigger. See `comparisonSuffix`. */
export type TriggerSuffix = { text: string; isExplicitRange: boolean };

/**
 * The trigger button + popover shell shared by every date-range dropdown.
 *
 * Only the shell lives here. What the trigger says, and what Apply does, differ
 * per surface (the dashboard's "Chart Default" has no window to summarise, and
 * fans changes out to three callbacks), so those stay with the callers rather
 * than becoming override props on one dropdown that the other has to thread.
 */
export default function DateRangeTriggerPopover({
  open,
  onOpenChange,
  label,
  tooltip,
  suffix,
  disabled,
  fullWidth = false,
  align = "end",
  triggerClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  tooltip?: string;
  /** Omit to render no "vs" summary — e.g. when no comparison is active. */
  suffix?: TriggerSuffix | null;
  disabled?: boolean;
  fullWidth?: boolean;
  /** "start" for a trigger sitting at the left of its row — the panel is wide
   * enough that end-anchoring it would run off the viewport. */
  align?: "start" | "center" | "end";
  /** Extra trigger styling for surfaces with their own control treatment. */
  triggerClassName?: string;
  /** The panel rendered inside the popover. */
  children: ReactNode;
}) {
  // An explicit range needs roughly twice the room of the "prior" shorthand.
  const maxWidth = suffix?.isExplicitRange ? 400 : 260;

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      align={align}
      showArrow={false}
      // The comparison-mode Select and the calendar render in their own Radix
      // poppers; clicking inside one must not dismiss this panel.
      onInteractOutside={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest("[data-radix-popper-content-wrapper]")
        ) {
          event.preventDefault();
        }
      }}
      contentStyle={{
        padding: 0,
        width: 640,
        // The panel can outgrow the viewport and nothing scrolls it, so Apply
        // was unreachable. Cap to the room Radix measured; the panel scrolls
        // its own body and keeps the footer pinned.
        maxHeight: "var(--radix-popover-content-available-height)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      trigger={
        <Button
          className={clsx(styles.trigger, triggerClassName)}
          variant="outline"
          // Neutral, with a surface fill: this sits beside Select-based controls
          // (variant="surface"), and Button's default violet made it read as the
          // odd one out in the toolbar.
          color="gray"
          size="md"
          disabled={disabled}
          icon={<PiCalendarBlank aria-hidden />}
          iconPosition="left"
          style={{
            justifyContent: "space-between",
            backgroundColor: "var(--color-surface)",
            ...(fullWidth ? { width: "100%" } : { maxWidth }),
          }}
        >
          <Flex align="center" gap="2" justify="between" width="100%">
            {/* Tooltip sits inside the Button, not around it — Popover matches on
                `trigger.type === Button` to pass `preventDefault`. */}
            <Tooltip content={tooltip ?? ""} enabled={!!tooltip}>
              <span
                style={{
                  // Absorb the slack so the label hugs the icon; without this
                  // `justify="between"` spreads it toward the middle.
                  flexGrow: 1,
                  minWidth: 0,
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            </Tooltip>
            {suffix && (
              <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                <Text size="sm" color="text-low" weight="regular">
                  vs {suffix.text}
                </Text>
              </span>
            )}
            <PiCaretDown aria-hidden style={{ flexShrink: 0 }} />
          </Flex>
        </Button>
      }
      content={children}
    />
  );
}
