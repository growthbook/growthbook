import clsx from "clsx";
import {
  FC,
  ReactElement,
  useState,
  Children,
  isValidElement,
  cloneElement,
  ReactNode,
  CSSProperties,
} from "react";
import useGlobalMenu from "@/services/useGlobalMenu";
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
  toggleClassName?: string;
  toggleClosedClassName?: string;
  toggleOpenClassName?: string;
  toggleStyle?: CSSProperties;
  open?: boolean;
  setOpen?: (open: boolean) => void;
  enabled?: boolean;
  children: ReactNode;
}> = ({
  uuid,
  toggle,
  header,
  children,
  caret = true,
  right = true,
  width = "auto",
  className = "",
  toggleClassName = "",
  toggleClosedClassName = "",
  toggleOpenClassName = "",
  toggleStyle,
  open,
  setOpen,
  enabled = true,
}) => {
  // If uncontrolled, use local state
  const [_open, _setOpen] = useState(false);
  if (!setOpen) {
    open = _open;
    setOpen = _setOpen;
  }

  useGlobalMenu(`.${uuid}`, () => setOpen?.(false));

  const content = Children.map(children, (child) => {
    if (!isValidElement(child)) return null;

    const element = child as ReactElement<{
      onClick?: () => void | Promise<void>;
      closeOnClick?: boolean;
    }>;
    if (element.type === DropdownLink && element.props.closeOnClick !== false) {
      return cloneElement(element, {
        onClick: () => {
          element.props.onClick?.();
          setOpen?.(false);
        },
      });
    }

    return element;
  });

  return (
    <div
      className={clsx("dropdown", uuid, styles.dropdownwrap, toggleClassName, {
        [styles.open]: !toggleOpenClassName && open,
      })}
      style={toggleStyle}
    >
      <div
        className={clsx({
          "dropdown-toggle": caret,
          [toggleOpenClassName]: open,
          [toggleClosedClassName]: !open,
        })}
        onClick={
          enabled
            ? (e) => {
                e.preventDefault();
                setOpen?.(!open);
              }
            : undefined
        }
        style={enabled ? { cursor: "pointer" } : {}}
      >
        {toggle}
      </div>
      {enabled && (
        <div
          className={clsx("dropdown-menu", styles.dropdownmenu, className, {
            "dropdown-menu-right": right,
            show: open,
          })}
          style={{ width }}
        >
          {header && <div className="dropdown-header">{header}</div>}
          {content}
        </div>
      )}
    </div>
  );
};
export default Dropdown;
