import React, { forwardRef } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { IconButton } from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiX } from "react-icons/pi";
import { RadixTheme } from "@/services/RadixTheme";
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
  ...props
}: PopoverProps) {
  const appliedContentStyle = {
    padding: "15px 20px",
    ...contentStyle,
  };

  // In case using our own button component, ensure preventDefault is false
  const clonedTrigger = React.isValidElement(trigger)
    ? React.cloneElement(trigger, { preventDefault: false } as Record<
        string,
        unknown
      >)
    : trigger;

  return (
    <RadixPopover.Root {...props}>
      {anchorOnly ? (
        <RadixPopover.Anchor
          asChild={triggerAsChild}
          className={styles.UnstyledTrigger}
        >
          {clonedTrigger}
        </RadixPopover.Anchor>
      ) : (
        <RadixPopover.Trigger asChild={triggerAsChild}>
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
              onEscapeKeyDown={
                disableDismiss ? (e) => e.preventDefault() : undefined
              }
              onPointerDownOutside={
                disableDismiss ? (e) => e.preventDefault() : undefined
              }
              onInteractOutside={
                disableDismiss ? (e) => e.preventDefault() : undefined
              }
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

// ============================================================================
// PopoverContent - Styled container without Radix positioning
// ============================================================================

interface PopoverContentProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * A styled popover container without Radix positioning.
 * Use this when you need popover styling but handle positioning yourself
 * (e.g., with useHoverTooltip's renderTooltip).
 */
export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  function PopoverContent({ children, style, className }, ref) {
    const appliedStyle: React.CSSProperties = {
      padding: "15px 20px",
      ...style,
    };

    return (
      <RadixTheme>
        <div
          ref={ref}
          className={`${styles.Content}${className ? ` ${className}` : ""}`}
          style={appliedStyle}
        >
          {children}
        </div>
      </RadixTheme>
    );
  },
);
