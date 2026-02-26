import {
  Box,
  Flex,
  DropdownMenu as RadixDropdownMenu,
  Text,
} from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiCaretDown, PiWarningFill } from "react-icons/pi";
import { amber } from "@radix-ui/colors";
import React, {
  ReactElement,
  useCallback,
  useEffect,
  useState,
  createContext,
  useContext,
} from "react";
import { createPortal } from "react-dom";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import Modal from "@/components/Modal";

type AllowedChildren = string | React.ReactNode;

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
  triggerStyle?: React.CSSProperties;
  menuPlacement?: "start" | "center" | "end";
  menuWidth?: "full" | number;
  children: AllowedChildren;
  color?: RadixDropdownMenu.ContentProps["color"];
  variant?: RadixDropdownMenu.ContentProps["variant"];
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  disabled?: boolean;
  modal?: boolean; // blocks clicks underneath the menu
} & MarginProps;

export function DropdownMenu({
  trigger,
  triggerClassName,
  triggerStyle,
  menuPlacement = "start",
  menuWidth,
  children,
  color,
  variant,
  disabled,
  open,
  onOpenChange,
  modal = false,
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

  // Track open state internally so we can show/hide the backdrop.
  const [isOpen, setIsOpen] = useState(open ?? false);
  useEffect(() => {
    if (open !== undefined) setIsOpen(open);
  }, [open]);
  const handleOpenChange = (o: boolean) => {
    setIsOpen(o);
    onOpenChange?.(o);
  };

  // isHidden/isHiddenWithDelay: keep the menu mounted but invisible while a
  // confirmation Modal is open above it (avoids remounting the Modal mid-flow).
  const [isHidden, setIsHidden] = useState(false);
  const [isHiddenWithDelay, setIsHiddenWithDelay] = useState(false);
  useEffect(() => {
    if (isHidden) {
      setIsHiddenWithDelay(true);
    } else {
      setTimeout(() => setIsHiddenWithDelay(false), 500);
    }
  }, [isHidden, isHiddenWithDelay]);

  const hideDropdown = () => setIsHidden(true);
  const showDropdown = () => setIsHidden(false);
  const closeDropdown = () => {
    setIsHidden(false);
    handleOpenChange(false);
  };

  // When modal=true, walk up from the Content node to find the Radix popper
  // wrapper and elevate its z-index above the backdrop (9998).
  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!modal || !node) return;
      let el: HTMLElement | null = node.parentElement;
      while (el) {
        if (el.hasAttribute("data-radix-popper-content-wrapper")) {
          el.style.zIndex = "9999";
          return;
        }
        el = el.parentElement;
      }
    },
    [modal],
  );

  return (
    <DropdownVisibilityContext.Provider
      value={{ hideDropdown, showDropdown, closeDropdown }}
    >
      {modal && isOpen && !isHidden
        ? createPortal(
            <div
              style={{ position: "fixed", inset: 0, zIndex: 9998 }}
              onClick={() => handleOpenChange(false)}
            />,
            document.body,
          )
        : null}
      <RadixDropdownMenu.Root
        {...props}
        modal={false}
        open={open !== undefined ? open : undefined}
        onOpenChange={handleOpenChange}
      >
        <RadixDropdownMenu.Trigger
          className={triggerClassName}
          style={triggerStyle}
          disabled={disabled}
        >
          {triggerComponent}
        </RadixDropdownMenu.Trigger>
        <RadixDropdownMenu.Content
          ref={contentRef}
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
        {loading || error ? (
          <Flex as="div" justify="between" align="center">
            <Box as="span" className={loading ? "font-italic" : ""}>
              {children}
            </Box>
            <Box width="14px" className="ml-3">
              {loading ? <LoadingSpinner /> : null}
              {error ? (
                <Tooltip body={`Error: ${error}. Exit menu and try again.`}>
                  <PiWarningFill color={amber.amber11} />
                </Tooltip>
              ) : null}
            </Box>
          </Flex>
        ) : (
          children
        )}
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
}: DropdownMenuLabelProps): JSX.Element {
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
}: React.ComponentProps<typeof RadixDropdownMenu.Group>): JSX.Element {
  return (
    <RadixDropdownMenu.Group {...props}>{children}</RadixDropdownMenu.Group>
  );
}
