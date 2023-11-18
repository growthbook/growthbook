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
  activeClassName?: string;
  notificationCount?: number;
  showNotificationCount?: boolean;
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
  activeClassName,
  showNotificationCount,
  notificationCount,
}: Props) {
  return (
    <a
      className={clsx(
        "nav-item nav-link",
        className,
        {
          active,
          last,
          "nav-button-item": newStyle,
        },
        activeClassName && active ? activeClassName : null
      )}
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
      {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
      {(showActiveCount || !active) && (count === 0 || count > 0) ? (
        <span className={`badge badge-gray ml-2`}>{count}</span>
      ) : (
        ""
      )}
      {showNotificationCount && notificationCount ? (
        <div
          className={`position-absolute badge d-flex justify-content-center align-self-center`}
          style={{
            zIndex: 1,
            width: 18,
            height: 18,
            right: 0,
            top: -1,
            borderRadius: 50,
            backgroundColor: "red",
            color: "white",
            lineHeight: 0.7,
          }}
        >
          {notificationCount}
        </div>
      ) : (
        ""
      )}
      {(active && action) || ""}
    </a>
  );
}
