import React, { ReactNode, FC, useState } from "react";
import uniqId from "uniqid";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  useFloating,
} from "@floating-ui/react";
import clsx from "clsx";
import { IconButton } from "@radix-ui/themes";
import useGlobalMenu from "@/services/useGlobalMenu";
import { RadixTheme } from "@/services/RadixTheme";

const MoreMenu: FC<{
  autoCloseOnClick?: boolean;
  className?: string;
  zIndex?: number;
  children: ReactNode;
  useRadix?: boolean;
  size?: number;
}> = ({
  children,
  autoCloseOnClick = true,
  className = "",
  zIndex = 1020,
  useRadix,
  size = 18,
}) => {
  const [open, setOpen] = useState(false);
  const [id] = useState(() => uniqId("more_menu_"));
  useGlobalMenu(`#${id}`, () => setOpen(false));

  const { refs, floatingStyles } = useFloating({
    open: open,
    onOpenChange: setOpen,
    placement: "bottom-end",
    middleware: [
      flip({
        fallbackAxisSideDirection: "start",
      }),
      offset(6),
    ],
    whileElementsMounted: autoUpdate,
  });

  // If there are no children, don't render the dropdown
  if (!React.Children.toArray(children).some((child) => !!child)) {
    return null;
  }

  return (
    <div
      className={clsx("dropdown position-relative", className, {
        "d-flex align-items-center": useRadix,
      })}
      id={id}
    >
      {useRadix ? (
        <div className="d-flex align-items-center">
          <IconButton
            variant="ghost"
            color="gray"
            radius="full"
            size="3"
            highContrast
            ref={refs.setReference}
            onClick={() => {
              setOpen(!open);
            }}
          >
            <BsThreeDotsVertical size={size} />
          </IconButton>
        </div>
      ) : (
        <a
          href="#"
          className="text-dark"
          style={{
            fontSize: "1.5em",
            lineHeight: "1em",
          }}
          ref={refs.setReference}
          onClick={(e) => {
            e.preventDefault();
            setOpen(!open);
          }}
        >
          <BsThreeDotsVertical />
        </a>
      )}
      <FloatingPortal>
        <RadixTheme>
          <div
            className={`dropdown-menu ${open ? "show" : ""}`}
            onClick={() => {
              if (autoCloseOnClick) {
                setOpen(false);
              }
            }}
            ref={refs.setFloating}
            style={{ ...floatingStyles, zIndex, width: "max-content" }}
          >
            {children}
          </div>
        </RadixTheme>
      </FloatingPortal>
    </div>
  );
};

export default MoreMenu;
