import {
  Box,
  Flex,
  DropdownMenu as RadixDropdownMenu,
  Text,
} from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiCaretDown, PiWarningFill } from "react-icons/pi";
import React, { ReactElement, useEffect, useState } from "react";
import { amber } from "@radix-ui/colors";
import Button from "@/ui/Button";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import Modal from "@/components/Modal";

type AllowedChildren = string | React.ReactNode;

type DropdownProps = {
  trigger: React.ReactNode;
  triggerClassName?: string;
  menuPlacement?: "start" | "center" | "end";
  menuWidth?: "full" | number;
  children: AllowedChildren;
  color?: RadixDropdownMenu.ContentProps["color"];
  variant?: RadixDropdownMenu.ContentProps["variant"];
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  disabled?: boolean;
} & MarginProps;

export function DropdownMenu({
  trigger,
  triggerClassName,
  menuPlacement = "start",
  menuWidth,
  children,
  color,
  variant,
  disabled,
  ...props
}: DropdownProps) {
  const triggerComponent =
    typeof trigger === "string" ? (
      <Button
        icon={disabled ? undefined : <PiCaretDown />}
        iconPosition="right"
      >
        {trigger}
      </Button>
    ) : (
      trigger
    );

  return (
    <RadixDropdownMenu.Root {...props} modal={false}>
      <RadixDropdownMenu.Trigger
        className={triggerClassName}
        disabled={disabled}
      >
        {triggerComponent}
      </RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Content
        align={menuPlacement}
        color={color}
        variant={variant}
        side="bottom"
        className={
          menuWidth === "full" ? "dropdown-content-width-full" : undefined
        }
        style={{ width: typeof menuWidth === "number" ? menuWidth : undefined }}
      >
        {children}
      </RadixDropdownMenu.Content>
    </RadixDropdownMenu.Root>
  );
}

type DropdownContentProps = {
  children: AllowedChildren;
  trigger: AllowedChildren;
  triggerClassName?: string;
} & MarginProps;

export function DropdownSubMenu({
  children,
  trigger,
  triggerClassName,
  ...props
}: DropdownContentProps) {
  return (
    <RadixDropdownMenu.Sub>
      <RadixDropdownMenu.SubTrigger className={triggerClassName}>
        {trigger}
      </RadixDropdownMenu.SubTrigger>
      <RadixDropdownMenu.SubContent {...props}>
        {children}
      </RadixDropdownMenu.SubContent>
    </RadixDropdownMenu.Sub>
  );
}

type DropdownItemProps = {
  children: AllowedChildren;
  className?: string;
  disabled?: boolean;
  onClick?: (event: Event) => Promise<void> | void;
  color?: "red" | "default";
  shortcut?: RadixDropdownMenu.ItemProps["shortcut"];
  confirmation?: {
    submit: () => Promise<void> | void;
    getConfirmationContent?: () => Promise<string | ReactElement | null>;
    confirmationTitle: string | ReactElement;
    cta: string;
    submitColor?: string;
  };
} & MarginProps;

export function DropdownMenuItem({
  children,
  disabled = false,
  shortcut,
  color,
  onClick,
  confirmation,
  ...props
}: DropdownItemProps) {
  if (color === "default") {
    color = undefined;
  }
  const [confirming, setConfirming] = useState(false);
  const [confirmationContent, setConfirmationContent] = useState<
    string | ReactElement | null
  >(null);
  useEffect(() => {
    if (!confirming || !confirmation || !confirmation.getConfirmationContent)
      return;
    confirmation
      .getConfirmationContent()
      .then((c) => setConfirmationContent(c))
      .catch((e) => console.error(e));
  }, [confirming, confirmation]);

  const [error, setError] = useState<null | string>(null);
  const [loading, setLoading] = useState(false);
  return (
    <>
      {confirmation && confirming && (
        <Modal
          trackingEventModalType=""
          header={confirmation.confirmationTitle}
          close={() => setConfirming(false)}
          open={true}
          cta={confirmation.cta}
          submitColor={confirmation.submitColor ?? "danger"}
          submit={confirmation.submit}
          increasedElevation={true}
        >
          {confirmationContent ?? "Are you sure? This action cannot be undone."}
        </Modal>
      )}
      <RadixDropdownMenu.Item
        disabled={disabled || !!error || !!loading}
        onSelect={async (event) => {
          event.preventDefault();
          if (confirmation) {
            setConfirming(true);
            return;
          }
          if (onClick) {
            setError(null);
            setLoading(true);
            try {
              await onClick(event);
              // If this promise is resolved without an error, we need to close
            } catch (e) {
              setError(e.message);
              console.error(e);
            }
            setLoading(false);
          }
        }}
        color={color}
        shortcut={shortcut}
        {...props}
      >
        <Flex as="div" justify="between" align="center">
          <Box as="span" className={`mr-2 ${loading ? "font-italic" : ""}`}>
            {children}
          </Box>
          {loading || error ? (
            <Box width="14px" className="ml-4">
              {loading ? <LoadingSpinner /> : null}
              {error ? (
                <Tooltip body={`Error: ${error}. Exit menu and try again.`}>
                  <PiWarningFill color={amber.amber11} />
                </Tooltip>
              ) : null}
            </Box>
          ) : null}
        </Flex>
      </RadixDropdownMenu.Item>
    </>
  );
}

type DropdownMenuLabelProps = React.ComponentProps<
  typeof RadixDropdownMenu.Label
>;

export function DropdownMenuLabel({
  children,
  ...props
}: DropdownMenuLabelProps): JSX.Element {
  return (
    <RadixDropdownMenu.Label {...props}>
      <Text color="gray">{children}</Text>
    </RadixDropdownMenu.Label>
  );
}

export function DropdownMenuSeparator() {
  return <RadixDropdownMenu.Separator />;
}

export function DropdownMenuGroup({
  children,
  ...props
}: React.ComponentProps<typeof RadixDropdownMenu.Group>): JSX.Element {
  return (
    <RadixDropdownMenu.Group {...props}>{children}</RadixDropdownMenu.Group>
  );
}
