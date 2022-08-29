import { createContext, ReactNode, useContext } from "react";
import { useLiteLayout, UseLiteLayout } from "../hooks/useLiteLayout";
import Layout from "../components/Layout/Layout";

// eslint-disable-next-line
const LayoutContext = createContext<UseLiteLayout>(undefined!);

export function useLayout() {
  return useContext(LayoutContext);
}

export const LayoutProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isLiteLayout, setIsLiteLayout] = useLiteLayout(false);

  return (
    <LayoutContext.Provider value={[isLiteLayout, setIsLiteLayout]}>
      {!isLiteLayout && <Layout />}
      {children}
    </LayoutContext.Provider>
  );
};
