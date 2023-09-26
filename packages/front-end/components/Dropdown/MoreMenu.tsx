import { ReactNode, FC, useState } from "react";
import uniqId from "uniqid";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  useClick,
  useFloating,
  useInteractions,
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

  const { refs, context, floatingStyles } = useFloating({
    open: open,
    onOpenChange: setOpen,
    middleware: [
      flip({
        fallbackAxisSideDirection: "start",
      }),
      offset(6),
    ],
    whileElementsMounted: autoUpdate,
  });
  const onClick = useClick(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([onClick]);

  return (
    <div className={`dropdown position-relative ${className}`} id={id}>
      <a
        href="#"
        className="text-dark"
        style={{
          fontSize: "1.5em",
        }}
        ref={refs.setReference}
        {...getReferenceProps()}
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
          style={{ ...floatingStyles, zIndex: 980, width: "max-content" }}
          {...getFloatingProps()}
        >
          {children}
        </div>
      </FloatingPortal>
    </div>
  );
};

export default MoreMenu;
