import { useUser } from "@/services/UserContext";
import { DataSourceOptionKey } from "./useDataSourceOptionEligibility";

type DataSourceOptionPricing = { headline: string; detail: string | null };

export function useDataSourceOptionPricing(): {
  pricing: Record<DataSourceOptionKey, DataSourceOptionPricing>;
  showPricing: boolean;
  pricingFootnote: string | null;
} {
  const { effectiveAccountPlan, license } = useUser();
  // The license plan is the plan the org is on. effectiveAccountPlan falls
  // back to Starter or OSS while a Pro license has an error, such as an
  // unverified email, which would show the Starter allowance.
  const plan = license?.plan || effectiveAccountPlan || "";
  const isProPlan = plan === "pro" || plan === "pro_sso";
  // Starter is capped at the included amount. Pro can continue at the overage rate.
  const meteredEvents: DataSourceOptionPricing = isProPlan
    ? {
        headline: "2M events/month included",
        detail: "then $30/M events",
      }
    : {
        headline: "1M events/month included*",
        detail: null,
      };

  return {
    pricing: {
      managed: meteredEvents,
      "event-forwarder": meteredEvents,
      custom: { headline: "No per-event cost", detail: null },
    },
    // Enterprise usage is billed per contract, so list pricing doesn't apply.
    showPricing: plan !== "enterprise",
    pricingFootnote:
      isProPlan || plan === "enterprise"
        ? null
        : "* The Starter plan is capped at the included limit. Upgrade to Pro to unlock usage-based billing above the included limit.",
  };
}
