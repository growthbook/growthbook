import { FC } from "react";

const Page: FC<{
  display: string;
  enabled?: boolean;
}> = ({ children }) => {
  return <>{children}</>;
};
export default Page;
