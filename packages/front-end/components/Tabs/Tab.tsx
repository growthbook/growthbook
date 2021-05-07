import { FC, ReactElement } from "react";

const Tab: FC<{
  display: string;
  count?: number;
  anchor?: string;
  lazy?: boolean;
  visible?: boolean;
  action?: ReactElement;
  className?: string;
}> = ({ children }) => {
  return <>{children}</>;
};

export default Tab;
