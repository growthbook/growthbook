import { FC, ReactNode } from "react";
import { Portal as RadixPortal } from "@radix-ui/themes";

const Portal: FC<{ children: ReactNode }> = ({ children }) => {
  return <RadixPortal>{children}</RadixPortal>;
};
export default Portal;
