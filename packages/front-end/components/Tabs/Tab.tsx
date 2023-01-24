import { ReactNode, FC, ReactElement } from "react";

const Tab: FC<{
  display: ReactNode;
  id?: string;
  count?: number;
  anchor?: string;
  lazy?: boolean;
  visible?: boolean;
  action?: ReactElement;
  className?: string;
  padding?: boolean;
  forceRenderOnFocus?: boolean;
  children: ReactNode;
}> = ({ children }) => {
  return <>{children}</>;
};

export default Tab;
