import clsx from "clsx";
import {
  FC,
  ReactElement,
  useState,
  Children,
  isValidElement,
  cloneElement,
} from "react";
import useGlobalMenu from "../../services/useGlobalMenu";
import DropdownLink from "./DropdownLink";

const Dropdown: FC<{
  uuid: string;
  toggle: string | ReactElement;
  header?: string | ReactElement;
}> = ({ uuid, toggle, header, children }) => {
  const [open, setOpen] = useState(false);
  useGlobalMenu(`.${uuid}`, () => setOpen(false));

  const content = Children.map(children, (child) => {
    if (!isValidElement(child)) return null;

    if (child.type === DropdownLink && child.props.closeOnClick !== false) {
      return cloneElement(child, {
        onClick: () => {
          child.props.onClick();
          setOpen(false);
        },
      });
    }

    return child;
  });

  return (
    <div className={clsx("dropdown", uuid)}>
      <div
        className="nav-link dropdown-toggle"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
        style={{ cursor: "pointer" }}
      >
        {toggle}
      </div>
      <div
        className={clsx("dropdown-menu dropdown-menu-right", {
          show: open,
        })}
      >
        {header && <div className="dropdown-header">{header}</div>}
        {content}
      </div>
    </div>
  );
};
export default Dropdown;
