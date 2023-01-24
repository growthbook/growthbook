import clsx from "clsx";
import { ReactElement } from "react";

export interface Props {
  active: boolean;
  last?: boolean;
  anchor?: string;
  onClick: () => void;
  display: string | ReactElement;
  count?: number;
  action?: ReactElement;
  newStyle?: boolean;
  className?: string;
  showActiveCount?: boolean;
}

export default function TabButton({
  active,
  last = false,
  anchor,
  onClick,
  display,
  count,
  action,
  newStyle = true,
  className,
  showActiveCount = false,
}: Props) {
  return (
    <a
      className={clsx("nav-item nav-link", className, {
        active,
        last,
        "nav-button-item": newStyle,
      })}
      role="tab"
      href={anchor ? `#${anchor}` : "#"}
      aria-selected={active ? "true" : "false"}
      onClick={(e) => {
        if (!anchor) {
          e.preventDefault();
        }
        onClick();
      }}
    >
      {display}
      {(showActiveCount || !active) && (count === 0 || count > 0) ? (
        <span className={`badge badge-gray ml-2`}>{count}</span>
      ) : (
        ""
      )}
      {(active && action) || ""}
    </a>
  );
}
