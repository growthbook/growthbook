import { createContext, useContext, useState } from "react";

interface StripeContextProps {
  clientSecret: string | null;
  setClientSecret: (secret: string | null) => void;
}

const StripeContext = createContext<StripeContextProps | undefined>(undefined);

export const StripeProviderWrapper = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  return (
    <StripeContext.Provider value={{ clientSecret, setClientSecret }}>
      {children}
    </StripeContext.Provider>
  );
};

export const useStripeContext = () => {
  const context = useContext(StripeContext);
  if (!context) {
    throw new Error(
      "useStripeContext must be used within a StripeProviderWrapper"
    );
  }
  return context;
};
