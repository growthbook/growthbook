import { ReactNode, FC, useState } from "react";
import uniqId from "uniqid";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  useFloating,
} from "@floating-ui/react";
import useGlobalMenu from "@/services/useGlobalMenu";

const MoreMenu: FC<{
  autoCloseOnClick?: boolean;
  className?: string;
  children: ReactNode;
}> = ({ children, autoCloseOnClick = true, className = "" }) => {
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

  return (
    <div className={`dropdown position-relative ${className}`} id={id}>
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
      <FloatingPortal>
        <div
          className={`dropdown-menu ${open ? "show" : ""}`}
          onClick={() => {
            if (autoCloseOnClick) {
              setOpen(false);
            }
          }}
          ref={refs.setFloating}
          style={{ ...floatingStyles, zIndex: 1000000, width: "max-content" }}
        >
          {children}
        </div>
      </FloatingPortal>
    </div>
  );
};

export default MoreMenu;
