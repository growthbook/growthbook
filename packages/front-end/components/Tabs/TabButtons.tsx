import clsx from "clsx";
import { ReactNode, FC } from "react";

const TabButtons: FC<{
  newStyle?: boolean;
  vertical?: boolean;
  className?: string;
  children: ReactNode;
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
