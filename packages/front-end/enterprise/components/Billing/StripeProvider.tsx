import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  createContext,
  ReactNode,
} from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import { useAuth } from "@/services/auth";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import LoadingOverlay from "@/components/LoadingOverlay";
import { getStripePublishableKey } from "@/services/env";
import track from "@/services/track";

interface StripeContextProps {
  clientSecret: string | null;
  setClientSecret: (secret: string | null) => void;
}

export const StripeContext = createContext<StripeContextProps | undefined>(
  undefined,
);

const DEFAULT_SETUP_INTENT_ENDPOINT =
  "/subscription/payment-methods/setup-intent";

export function StripeProvider({
  children,
  setupIntentEndpoint = DEFAULT_SETUP_INTENT_ENDPOINT,
}: {
  children: ReactNode;
  setupIntentEndpoint?: string;
}) {
  const { apiCall } = useAuth();
  const { theme } = useAppearanceUITheme();

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const stripePublishableKey = getStripePublishableKey();

  const stripePromise = useMemo(
    () => (stripePublishableKey ? loadStripe(stripePublishableKey) : null),
    [stripePublishableKey],
  );

  // Guard against concurrent invocations
  const inFlightRef = useRef(false);

  const setupStripe = useCallback(async () => {
    if (!stripePublishableKey) {
      setError("Missing Stripe Publishable Key");
      return;
    }

    if (clientSecret || !stripePromise || inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const stripe = await stripePromise;
      if (!stripe) {
        throw new Error("Stripe failed to load");
      }

      // Create a Radar session to tie Stripe.js fraud signals (device
      // fingerprint, behavioral data) to the SetupIntent we're about to
      // create. Non-fatal: if this fails, fall back to no session ID.
      let radarSessionId: string | undefined;
      try {
        const { radarSession } = await stripe.createRadarSession();
        radarSessionId = radarSession?.id;
      } catch (e) {
        console.warn("Failed to create Radar session", e);
      }

      const { clientSecret: secret } = await apiCall<{
        clientSecret: string;
      }>(setupIntentEndpoint, {
        method: "POST",
        body: JSON.stringify({ radarSessionId }),
      });

      setClientSecret(secret);
    } catch (e) {
      console.error("Failed to set up Stripe:", e);
      setError(e.message);
    } finally {
      inFlightRef.current = false;
    }
  }, [
    apiCall,
    clientSecret,
    stripePublishableKey,
    stripePromise,
    setupIntentEndpoint,
  ]);

  const retrySetupStripe = useCallback(() => {
    track("StripeProvider: retry setup intent", { setupIntentEndpoint });
    setError(undefined);
    setupStripe();
  }, [setupStripe, setupIntentEndpoint]);

  useEffect(() => {
    if (stripePublishableKey) setupStripe();
  }, [setupStripe, stripePublishableKey]);

  if (!stripePublishableKey)
    return <Callout status="error">Missing Stripe Publishable Key</Callout>;
  if (error)
    return (
      <Callout
        status="error"
        action={
          <Button color="inherit" variant="soft" onClick={retrySetupStripe}>
            Retry
          </Button>
        }
      >
        {error}
      </Callout>
    );
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
