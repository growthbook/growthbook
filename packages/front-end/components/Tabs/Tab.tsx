import { FC, ReactElement } from "react";

const Tab: FC<{
  display: string;
  id?: string;
  count?: number;
  anchor?: string;
  lazy?: boolean;
  visible?: boolean;
  action?: ReactElement;
  className?: string;
  padding?: boolean;
}> = ({ children }) => {
  return <>{children}</>;
};

export default Tab;
