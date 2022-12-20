import clsx from "clsx";
import { ReactNode, FC, useState } from "react";
import uniqId from "uniqid";
import { BsThreeDotsVertical } from "react-icons/bs";
import useGlobalMenu from "@/services/useGlobalMenu";

const MoreMenu: FC<{
  autoCloseOnClick?: boolean;
  className?: string;
  children: ReactNode;
}> = ({ children, autoCloseOnClick = true, className = "" }) => {
  const [open, setOpen] = useState(false);
  const [id] = useState(uniqId("more_menu_"));
  useGlobalMenu(`#${id}`, () => setOpen(false));
  return (
    <div className={`dropdown ${className}`} id={id}>
      <a
        href="#"
        className="text-dark"
        style={{
          fontSize: "1.5em",
        }}
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <BsThreeDotsVertical />
      </a>
      <div
        className={clsx("dropdown-menu dropdown-menu-right", {
          show: open,
        })}
        onClick={() => {
          if (autoCloseOnClick) {
            setOpen(false);
          }
        }}
        style={{ zIndex: 980 }}
      >
        {children}
      </div>
    </div>
  );
};

export default MoreMenu;
