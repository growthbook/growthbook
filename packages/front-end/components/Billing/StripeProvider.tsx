import { useState, useEffect, useCallback } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { stripePromise } from "@/pages/_app";
import Callout from "../Radix/Callout";
import LoadingOverlay from "../LoadingOverlay";
import { useStripeContext } from "./StripeProviderWrapper";

export default function StripeProvider({ children }) {
  const { apiCall } = useAuth();
  const { subscription } = useUser();
  const { theme } = useAppearanceUITheme();
  const { clientSecret, setClientSecret } = useStripeContext();
  const [error, setError] = useState<string | undefined>(undefined);

  const getClientSecret = useCallback(async () => {
    if (!subscription) {
      setError("Adding a card requires a subscription");
      return;
    }

    try {
      const res: { clientSecret: string } = await apiCall(
        "/subscription/payment-methods/setup-intent",
        {
          method: "POST",
          body: JSON.stringify({ subscriptionId: subscription.externalId }),
        }
      );
      setClientSecret(res.clientSecret);
    } catch (error) {
      console.error("Failed to get client secret:", error);
      setError(error.message);
    }
  }, [apiCall, setClientSecret, subscription]);

  useEffect(() => {
    getClientSecret();
  }, [getClientSecret]);

  if (error) return <Callout status="error">{error}</Callout>;
  if (!clientSecret) return <LoadingOverlay />;

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: theme === "light" ? "stripe" : "night",
        },
      }}
    >
      {children}
    </Elements>
  );
}
