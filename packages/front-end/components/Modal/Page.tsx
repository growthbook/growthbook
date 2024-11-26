import { ReactNode, FC } from "react";

const Page: FC<{
  display: string | ReactNode;
  enabled?: boolean;
  validate?: () => Promise<void>;
  customNext?: () => void;
  children: ReactNode;
}> = ({ children }) => {
  return <>{children}</>;
};
export default Page;
