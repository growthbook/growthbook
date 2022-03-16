import clsx from "clsx";
import { FC } from "react";

const TabButtons: FC<{
  newStyle?: boolean;
  vertical?: boolean;
  className?: string;
}> = ({ children, newStyle = true, vertical = false, className }) => {
  return (
    <div className={newStyle ? "buttontabs" : ""}>
      <div
        className={clsx("nav", className, {
          "nav-button-tabs": newStyle,
          "nav-tabs": !vertical,
          "nav-pills flex-column": vertical,
        })}
        role="tablist"
      >
        {children}
      </div>
    </div>
  );
};

export default TabButtons;
