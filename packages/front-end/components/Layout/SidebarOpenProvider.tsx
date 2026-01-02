import React, { createContext, useContext, useState } from "react";

type Props = {
  children: React.ReactNode;
};
type Context = {
  open: boolean;
  setOpen: React.Dispatch<boolean>;
};

const SidebarOpenContext = createContext<Context | null>(null);

export const SidebarOpenProvider = ({ children }: Props) => {
  const [open, setOpen] = useState(false);
  return (
    <SidebarOpenContext.Provider value={{ open, setOpen }}>
      {children}
    </SidebarOpenContext.Provider>
  );
};

export const useSidebarOpen = () => {
  const context = useContext(SidebarOpenContext);

  if (!context)
    throw new Error(
      "SidebarOpen must be called from within the SidebarOpenProvider",
    );

  return context;
};
