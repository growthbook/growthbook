import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  createContext,
  ReactNode,
} from "react";
import { Elements } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import { useAuth } from "@/services/auth";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import { getStripePublishableKey } from "@/services/env";

interface StripeContextProps {
  clientSecret: string | null;
  setClientSecret: (secret: string | null) => void;
}

export const StripeContext = createContext<StripeContextProps | undefined>(
  undefined,
);

export function StripeProvider({
  children,
  initialClientSecret,
}: {
  children: ReactNode;
  initialClientSecret?: string;
}) {
  const { apiCall } = useAuth();
  const { theme } = useAppearanceUITheme();

  const [clientSecret, setClientSecret] = useState<string | null>(
    initialClientSecret || null,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  const stripePublishableKey = getStripePublishableKey();

  // Dynamically load Stripe.js only when we have a publishable key
  // This prevents Stripe from being loaded for self-hosted orgs without a key
  const stripePromise = useMemo(() => {
    if (!stripePublishableKey) {
      return null;
    }
    // Dynamic import to prevent bundling Stripe.js when not needed
    return import("@stripe/stripe-js").then((module) =>
      module.loadStripe(stripePublishableKey),
    ) as Promise<Stripe | null>;
  }, [stripePublishableKey]);

  const setupStripe = useCallback(async () => {
    if (!stripePublishableKey) {
      setError("Missing Stripe Publishable Key");
      return;
    }

    if (!clientSecret) {
      try {
        // otherwise we need to get a client secret
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
    }
  }, [apiCall, clientSecret, stripePublishableKey]);

  useEffect(() => {
    if (stripePublishableKey) setupStripe();
  }, [setupStripe, stripePublishableKey]);

  if (!stripePublishableKey)
    return <Callout status="error">Missing Stripe Publishable Key</Callout>;
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
              colorBackground: theme === "dark" ? "#141929" : "#ffffff",
              focusBoxShadow: "none",
            },
          },
        }}
      >
        {children}
      </Elements>
    </StripeContext.Provider>
  );
}
