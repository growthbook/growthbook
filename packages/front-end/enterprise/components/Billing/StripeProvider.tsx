import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  createContext,
} from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import Callout from "@/components/Radix/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";

interface StripeContextProps {
  clientSecret: string | null;
  setClientSecret: (secret: string | null) => void;
}

export const StripeContext = createContext<StripeContextProps | undefined>(
  undefined
);

export function StripeProvider({ children }) {
  const { apiCall } = useAuth();
  const { subscription } = useUser();
  const { theme } = useAppearanceUITheme();

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const stripePublishableKey =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

  const stripePromise = useMemo(
    () => (stripePublishableKey ? loadStripe(stripePublishableKey) : null),
    [stripePublishableKey]
  );

  const setupStripe = useCallback(async () => {
    if (!subscription) {
      setError("Adding a card requires a subscription");
      return;
    }
    if (!stripePublishableKey) {
      setError("Missing Stripe Publishable Key");
      return;
    }

    try {
      const {
        clientSecret,
      }: {
        clientSecret: string;
      } = await apiCall("/subscription/payment-methods/setup-intent", {
        method: "POST",
      });

      setClientSecret(clientSecret);
    } catch (error) {
      console.error("Failed to get client secret:", error);
      setError(error.message);
    }
  }, [apiCall, subscription, stripePublishableKey]);

  useEffect(() => {
    if (stripePublishableKey) setupStripe();
  }, [setupStripe, stripePublishableKey]);

  if (!stripePublishableKey) return null;
  if (error) return <Callout status="error">{error}</Callout>;
  if (!clientSecret || !stripePromise) return <LoadingOverlay />;

  return (
    <StripeContext.Provider value={{ clientSecret, setClientSecret }}>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret,
          appearance: {
            theme: theme === "light" ? "stripe" : "night",
            variables: {
              colorPrimary: "#aa99ec",
            },
          },
        }}
      >
        {children}
      </Elements>
    </StripeContext.Provider>
  );
}
