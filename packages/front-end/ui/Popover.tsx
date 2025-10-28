import React from "react";
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
  content: AllowedChildren;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  showCloseButton?: boolean;
  showArrow?: boolean;
  disableDismiss?: boolean;
  anchorOnly?: boolean;
} & MarginProps;

export function Popover({
  trigger,
  content,
  side = "bottom",
  align = "center",
  showCloseButton = false,
  showArrow = true,
  disableDismiss = false,
  anchorOnly = false,
  ...props
}: PopoverProps) {
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
        <RadixPopover.Anchor asChild>{clonedTrigger}</RadixPopover.Anchor>
      ) : (
        <RadixPopover.Trigger asChild>{clonedTrigger}</RadixPopover.Trigger>
      )}
      <RadixPopover.Portal>
        <RadixTheme>
          <RadixPopover.Content
            side={side}
            align={align}
            className={styles.Content}
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
                <IconButton variant="ghost" color="gray" size="1" radius="full">
                  <PiX />
                </IconButton>
              </RadixPopover.Close>
            )}
            {content}
            {showArrow && <RadixPopover.Arrow className={styles.Arrow} />}
          </RadixPopover.Content>
        </RadixTheme>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
