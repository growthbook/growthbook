import { FC } from "react";

const Page: FC<{
  display: string;
  enabled?: boolean;
  validate?: () => Promise<void>;
}> = ({ children }) => {
  return <>{children}</>;
};
export default Page;
