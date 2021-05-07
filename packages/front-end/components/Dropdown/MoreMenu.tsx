import clsx from "clsx";
import { FC, useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import useGlobalMenu from "../../services/useGlobalMenu";

const MoreMenu: FC<{
  id: string;
  autoCloseOnClick?: boolean;
}> = ({ children, id, autoCloseOnClick = true }) => {
  const [open, setOpen] = useState(false);
  useGlobalMenu(`#${id}`, () => setOpen(false));
  return (
    <div className="dropdown" id={id}>
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
