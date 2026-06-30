import React, { forwardRef, useRef, useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { IconButton } from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiX } from "react-icons/pi";
import { RadixTheme } from "@/services/RadixTheme";
import Button from "./Button";
import styles from "./Popover.module.scss";

type AllowedChildren = string | React.ReactNode;

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
  content: AllowedChildren;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
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
  // Open on hover of the trigger (and stay open while hovering the content)
  // instead of on click. The content does not steal focus — suitable for
  // read-only previews, including inside menus.
  openOnHover?: boolean;
} & MarginProps;

export function Popover({
  trigger,
  triggerAsChild = true,
  content,
  side = "bottom",
  align = "center",
  showCloseButton = false,
  showArrow = true,
  disableDismiss = false,
  anchorOnly = false,
  contentStyle,
  contentClassName,
  onFocusOutside,
  onInteractOutside,
  openOnHover = false,
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
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const hoverHandlers = openOnHover
    ? {
        onMouseEnter: () => {
          cancelClose();
          setHoverOpen(true);
        },
        onMouseLeave: () => {
          cancelClose();
          closeTimer.current = setTimeout(() => setHoverOpen(false), 120);
        },
      }
    : {};

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
      {anchorOnly ? (
        <RadixPopover.Anchor
          asChild={triggerAsChild}
          className={styles.UnstyledTrigger}
          {...hoverHandlers}
        >
          {clonedTrigger}
        </RadixPopover.Anchor>
      ) : (
        <RadixPopover.Trigger asChild={triggerAsChild} {...hoverHandlers}>
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
              className={`${styles.Content}${contentClassName ? ` ${contentClassName}` : ""}`}
              style={appliedContentStyle}
              {...hoverHandlers}
              onOpenAutoFocus={
                openOnHover ? (e) => e.preventDefault() : undefined
              }
              onEscapeKeyDown={
                disableDismiss ? (e) => e.preventDefault() : undefined
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
