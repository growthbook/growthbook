import {
  Box,
  Flex,
  DropdownMenu as RadixDropdownMenu,
  Text,
} from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiCaretDown, PiWarningFill } from "react-icons/pi";
import React, {
  ReactElement,
  useEffect,
  useState,
  createContext,
  useContext,
} from "react";
import { amber } from "@radix-ui/colors";
import Button from "@/ui/Button";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import Modal from "@/components/Modal";

type AllowedChildren = string | React.ReactNode;

// This context is used to hide and show the dropdown menu when a confirmation modal is open
type DropdownVisibilityContextType = {
  hideDropdown: () => void;
  showDropdown: () => void;
  closeDropdown: () => void;
};

const DropdownVisibilityContext =
  createContext<DropdownVisibilityContextType | null>(null);

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
  open,
  onOpenChange,
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

  // Used to hide dropdown while confirmation modal is open without destroying <Modal> component
  const [isHidden, setIsHidden] = useState(false);
  const [isHiddenWithDelay, setIsHiddenWithDelay] = useState(false);
  // Use a delayed render effect to account for dropdown closing animation.
  useEffect(() => {
    if (isHidden) {
      setIsHiddenWithDelay(true);
    } else {
      setTimeout(() => {
        setIsHiddenWithDelay(false);
      }, 500);
    }
  }, [isHidden, isHiddenWithDelay, setIsHiddenWithDelay]);

  const hideDropdown = () => setIsHidden(true);
  const showDropdown = () => setIsHidden(false);
  const closeDropdown = () => {
    setIsHidden(false);
    onOpenChange?.(false);
  };

  return (
    <DropdownVisibilityContext.Provider
      value={{ hideDropdown, showDropdown, closeDropdown }}
    >
      <RadixDropdownMenu.Root
        {...props}
        modal={false}
        open={open}
        onOpenChange={onOpenChange}
      >
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
          style={{
            width: typeof menuWidth === "number" ? menuWidth : undefined,
            visibility: isHiddenWithDelay ? "hidden" : "visible",
          }}
        >
          {children}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Root>
    </DropdownVisibilityContext.Provider>
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
    hideDropdown?: () => void;
    showDropdown?: () => void;
    closeDropdown?: () => void;
  };
  style?: React.CSSProperties;
} & MarginProps;

export function DropdownMenuItem({
  children,
  disabled = false,
  shortcut,
  color,
  onClick,
  confirmation,
  style,
  ...props
}: DropdownItemProps) {
  if (color === "default") {
    color = undefined;
  }
  const visibilityContext = useContext(DropdownVisibilityContext);
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

  // Get hideDropdown, showDropdown, and closeDropdown from confirmation prop or context
  // Context is the primary source (provided by DropdownMenu), but can be overridden
  const hideDropdown =
    confirmation?.hideDropdown ?? visibilityContext?.hideDropdown;
  const showDropdown =
    confirmation?.showDropdown ?? visibilityContext?.showDropdown;
  const closeDropdown =
    confirmation?.closeDropdown ?? visibilityContext?.closeDropdown;

  const handleClose = () => {
    setConfirming(false);
    showDropdown?.();
    closeDropdown?.();
  };

  return (
    <>
      {confirmation && confirming && (
        <Modal
          trackingEventModalType=""
          header={confirmation.confirmationTitle}
          close={handleClose}
          open={true}
          cta={confirmation.cta}
          submitColor={confirmation.submitColor ?? "danger"}
          submit={async () => {
            await confirmation.submit();
            handleClose();
          }}
          increasedElevation={true}
          useRadixButton={true}
        >
          {confirmationContent ?? "Are you sure? This action cannot be undone."}
        </Modal>
      )}
      <RadixDropdownMenu.Item
        disabled={disabled || !!error || !!loading}
        onSelect={async (event) => {
          event.preventDefault();
          if (confirmation) {
            if (!hideDropdown || !showDropdown) {
              console.error(
                "confirmation requires hideDropdown and showDropdown. Ensure DropdownMenuItem is used within a DropdownMenu component.",
              );
              return;
            }
            hideDropdown();
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
        <Flex as="div" justify="between" align="center" style={style}>
          <Box as="span" className={`mr-2 ${loading ? "font-italic" : ""}`}>
            {children}
          </Box>
          {loading || error ? (
            <Box width="14px" className="ml-3">
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
> & {
  textStyle?: React.CSSProperties;
  textSize?: "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
  textColor?: React.ComponentProps<typeof Text>["color"];
};

export function DropdownMenuLabel({
  children,
  textStyle,
  textSize,
  textColor = "gray",
  ...props
}: DropdownMenuLabelProps): React.ReactNode {
  return (
    <RadixDropdownMenu.Label {...props}>
      <Text color={textColor} size={textSize} style={textStyle}>
        {children}
      </Text>
    </RadixDropdownMenu.Label>
  );
}

export function DropdownMenuSeparator() {
  return <RadixDropdownMenu.Separator />;
}

export function DropdownMenuGroup({
  children,
  ...props
}: React.ComponentProps<typeof RadixDropdownMenu.Group>): React.ReactNode {
  return (
    <RadixDropdownMenu.Group {...props}>{children}</RadixDropdownMenu.Group>
  );
}
