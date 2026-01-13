import { useContext } from "react";
import { StripeContext } from "@/enterprise/components/Billing/StripeProvider";

export const useStripeContext = () => {
  const context = useContext(StripeContext);
  if (!context) {
    throw new Error("useStripeContext must be used within a StripeProvider");
  }
  return context;
};
