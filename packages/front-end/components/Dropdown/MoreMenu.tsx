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

const MoreMenu: FC<{
  autoCloseOnClick?: boolean;
  className?: string;
  zIndex?: number;
  children: ReactNode;
  useRadix?: boolean;
}> = ({
  children,
  autoCloseOnClick = true,
  className = "",
  zIndex = 1020,
  useRadix,
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
            size="4"
            highContrast
            ref={refs.setReference}
            onClick={() => {
              setOpen(!open);
            }}
          >
            <BsThreeDotsVertical size={18} />
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
      </FloatingPortal>
    </div>
  );
};

export default MoreMenu;
