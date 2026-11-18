import React, { forwardRef, useEffect, useRef, useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import clsx from "clsx";
import { IconButton } from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiX } from "react-icons/pi";
import { RadixTheme } from "@/services/RadixTheme";
import Button from "./Button";
import styles from "./Popover.module.scss";

type AllowedChildren = string | React.ReactNode;

// Radix's default arrow height
const ARROW_HEIGHT = 5;

type ControlledPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultOpen?: never;
};

type UncontrolledPopoverProps = {
  open?: never;
  onOpenChange?: never;
  defaultOpen?: boolean;
};

type PopoverProps = (ControlledPopoverProps | UncontrolledPopoverProps) & {
  trigger: React.ReactNode;
  triggerAsChild?: boolean;
  /** Positions the popover against this element. The trigger still opens it. */
  anchor?: React.ReactNode;
  content: AllowedChildren;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  /** Shift along the alignment axis, for anchors whose edge is not their box. */
  alignOffset?: number;
  showCloseButton?: boolean;
  showArrow?: boolean;
  disableDismiss?: boolean;
  anchorOnly?: boolean;
  contentStyle?: React.CSSProperties;
  contentClassName?: string;
  /** Called when focus moves outside — call e.preventDefault() to keep the popover open. */
  onFocusOutside?: React.ComponentProps<
    typeof RadixPopover.Content
  >["onFocusOutside"];
  /** Called on outside interactions — call e.preventDefault() to keep the popover open. */
  onInteractOutside?: React.ComponentProps<
    typeof RadixPopover.Content
  >["onInteractOutside"];
  /** Called when the content mounts and would auto-focus — call e.preventDefault() to keep focus on the anchor (e.g. a combobox input). */
  onOpenAutoFocus?: React.ComponentProps<
    typeof RadixPopover.Content
  >["onOpenAutoFocus"];
  // e.preventDefault() leaves focus where it went (e.g. a modal it opened)
  // instead of returning it to the trigger.
  onCloseAutoFocus?: React.ComponentProps<
    typeof RadixPopover.Content
  >["onCloseAutoFocus"];
  /** Called on Escape. Call e.preventDefault() to keep the popover open. */
  onEscapeKeyDown?: React.ComponentProps<
    typeof RadixPopover.Content
  >["onEscapeKeyDown"];
  // False pins the popover to `side` instead of flipping it when space runs out.
  avoidCollisions?: boolean;
  // Open on hover of the trigger (and stay open while hovering the content)
  // instead of on click. The content does not steal focus — suitable for
  // read-only previews, including inside menus.
  openOnHover?: boolean;
  // With openOnHover: ms the pointer rests on the trigger before it opens.
  hoverDelay?: number;
} & MarginProps;

export function Popover({
  trigger,
  triggerAsChild = true,
  anchor,
  content,
  side = "bottom",
  align = "center",
  sideOffset,
  alignOffset,
  showCloseButton = false,
  showArrow = true,
  disableDismiss = false,
  anchorOnly = false,
  contentStyle,
  contentClassName,
  onFocusOutside,
  onInteractOutside,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  openOnHover = false,
  hoverDelay = 0,
  avoidCollisions,
  ...props
}: PopoverProps) {
  const {
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
    defaultOpen,
    ...marginProps
  } = props as {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
  };

  // Hover-trigger handling: manage open state internally and keep the popover
  // open while the pointer is over either the trigger or the content. A short
  // close delay bridges the gap between them.
  const [hoverOpen, setHoverOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimers = () => {
    for (const timer of [closeTimer, openTimer]) {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    }
  };
  useEffect(() => cancelTimers, []);
  const hoverHandlers = openOnHover
    ? {
        onMouseEnter: () => {
          cancelTimers();
          if (hoverOpen || !hoverDelay) setHoverOpen(true);
          else
            openTimer.current = setTimeout(
              () => setHoverOpen(true),
              hoverDelay,
            );
        },
        onMouseLeave: () => {
          cancelTimers();
          closeTimer.current = setTimeout(() => setHoverOpen(false), 120);
        },
      }
    : {};

  // Sizes the strip that bridges the gap to the trigger (.HoverBridge). Radix
  // starts the open animation once it has placed the popover. Content that
  // scrolls would clip the strip, so it gets none.
  const triggerNode = useRef<HTMLElement | null>(null);
  const setTriggerNode = (node: HTMLElement | null) => {
    triggerNode.current = node;
  };
  const fitBridge = (e: React.AnimationEvent<HTMLDivElement>) => {
    const content = e.currentTarget;
    const trigger = triggerNode.current;
    if (e.target !== content || !trigger) return;
    if (getComputedStyle(content).overflowY !== "visible") return;
    const t = trigger.getBoundingClientRect();
    const c = content.getBoundingClientRect();
    // Above or below, it spans the whole edge so any path from the trigger
    // lands on it. Beside (menus), only the trigger, clear of other options.
    const [start, end] = ["top", "bottom"].includes(content.dataset.side ?? "")
      ? [Math.min(t.left - c.left, 0), Math.max(t.right - c.left, c.width)]
      : [t.top - c.top, t.bottom - c.top];
    const gap = (sideOffset ?? 0) + (showArrow ? ARROW_HEIGHT : 0);
    content.style.setProperty("--hover-bridge", `${gap}px`);
    content.style.setProperty("--hover-bridge-start", `${start}px`);
    content.style.setProperty("--hover-bridge-length", `${end - start}px`);
  };

  const rootProps = openOnHover
    ? { open: hoverOpen, onOpenChange: setHoverOpen }
    : {
        open: controlledOpen,
        onOpenChange: controlledOnOpenChange,
        defaultOpen,
      };

  const appliedContentStyle = {
    padding: "15px 20px",
    ...contentStyle,
  };

  // Override the @/ui/Button default of preventDefault=true so it doesn't
  // interfere with Radix Popover's open/close handling. Only applies to that
  // component — passing the prop to a DOM element triggers a React warning.
  const clonedTrigger =
    React.isValidElement(trigger) && trigger.type === Button
      ? React.cloneElement(trigger, { preventDefault: false } as Record<
          string,
          unknown
        >)
      : trigger;

  return (
    <RadixPopover.Root {...marginProps} {...rootProps}>
      {anchor ? (
        <RadixPopover.Anchor asChild>{anchor}</RadixPopover.Anchor>
      ) : null}
      {anchorOnly ? (
        <RadixPopover.Anchor
          ref={setTriggerNode}
          asChild={triggerAsChild}
          className={styles.UnstyledTrigger}
          {...hoverHandlers}
        >
          {clonedTrigger}
        </RadixPopover.Anchor>
      ) : (
        <RadixPopover.Trigger
          ref={setTriggerNode}
          asChild={triggerAsChild}
          {...hoverHandlers}
        >
          {clonedTrigger}
        </RadixPopover.Trigger>
      )}
      <RadixPopover.Portal>
        {/* Wrapper div required to avoid React warning about invalid DOM nesting when RadixTheme renders a fragment */}
        <div>
          <RadixTheme>
            <RadixPopover.Content
              side={side}
              align={align}
              sideOffset={sideOffset}
              alignOffset={alignOffset}
              avoidCollisions={avoidCollisions}
              className={clsx(
                styles.Content,
                openOnHover && styles.HoverBridge,
                contentClassName,
              )}
              style={appliedContentStyle}
              {...hoverHandlers}
              onAnimationStart={openOnHover ? fitBridge : undefined}
              onOpenAutoFocus={
                openOnHover ? (e) => e.preventDefault() : onOpenAutoFocus
              }
              onCloseAutoFocus={onCloseAutoFocus}
              onEscapeKeyDown={
                disableDismiss ? (e) => e.preventDefault() : onEscapeKeyDown
              }
              onPointerDownOutside={
                disableDismiss ? (e) => e.preventDefault() : undefined
              }
              onInteractOutside={
                disableDismiss ? (e) => e.preventDefault() : onInteractOutside
              }
              onFocusOutside={onFocusOutside}
            >
              {showCloseButton && (
                <RadixPopover.Close
                  asChild
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                  }}
                >
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    radius="full"
                  >
                    <PiX />
                  </IconButton>
                </RadixPopover.Close>
              )}
              {content}
              {showArrow && <RadixPopover.Arrow className={styles.Arrow} />}
            </RadixPopover.Content>
          </RadixTheme>
        </div>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/**
 * A styled popover container without Radix positioning.
 * Use this when you need popover styling but handle positioning yourself
 */
export const PopoverContent = forwardRef<
  HTMLDivElement,
  { children: React.ReactNode }
>(function PopoverContent({ children }, ref) {
  return (
    <div ref={ref} className={styles.Content}>
      {children}
    </div>
  );
});
