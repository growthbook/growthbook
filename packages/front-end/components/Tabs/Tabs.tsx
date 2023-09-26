import { ReactNode, FC, useState, ReactElement } from "react";
import ControlledTabs from "./ControlledTabs";

const Tabs: FC<{
  orientation?: "vertical" | "horizontal";
  className?: string;
  navClassName?: string;
  tabContentsClassName?: string;
  defaultTab?: string;
  newStyle?: boolean;
  navExtra?: ReactElement;
  children?: ReactNode;
  showActiveCount?: boolean;
}> = ({ children, defaultTab, ...props }) => {
  const [active, setActive] = useState<string | null>(defaultTab || null);

  return (
    <ControlledTabs
      {...props}
      defaultTab={defaultTab}
      active={active}
      setActive={setActive}
    >
      {children}
    </ControlledTabs>
  );
};

export default Tabs;
