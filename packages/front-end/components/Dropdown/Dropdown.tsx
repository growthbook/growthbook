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
import styles from "./Dropdown.module.scss";

const Dropdown: FC<{
  uuid: string;
  toggle: string | ReactElement;
  header?: string | ReactElement;
  caret?: boolean;
  right?: boolean;
  width?: number | string;
  className?: string;
}> = ({
  uuid,
  toggle,
  header,
  children,
  caret = true,
  right = true,
  width = "auto",
  className = "",
}) => {
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
    <div
      className={clsx("dropdown", uuid, styles.dropdownwrap, {
        [styles.open]: open,
      })}
    >
      <div
        className={clsx({ "dropdown-toggle": caret })}
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
        style={{ cursor: "pointer" }}
      >
        {toggle}
      </div>
      <div
        className={clsx("dropdown-menu", className, {
          "dropdown-menu-right": right,
          show: open,
        })}
        style={{ width }}
      >
        {header && <div className="dropdown-header">{header}</div>}
        {content}
      </div>
    </div>
  );
};
export default Dropdown;
