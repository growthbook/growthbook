import { useUser } from "@/services/UserContext";
import { DataSourceOptionKey } from "./useDataSourceOptionEligibility";

type DataSourceOptionPricing = { headline: string; detail: string | null };

export function useDataSourceOptionPricing(): {
  pricing: Record<DataSourceOptionKey, DataSourceOptionPricing>;
  showPricing: boolean;
  pricingFootnote: string | null;
} {
  const { effectiveAccountPlan } = useUser();
  const plan = effectiveAccountPlan || "";
  const isPaidPlan = ["pro", "pro_sso", "enterprise"].includes(plan);
  const overageDetail = "then $30/M events";

  return {
    pricing: {
      managed: {
        headline: `${isPaidPlan ? "2M" : "1M"} events/month included`,
        detail: `${overageDetail}${isPaidPlan ? "" : "*"}`,
      },
      "event-forwarder": {
        headline: "2M events/month included",
        detail: overageDetail,
      },
      custom: { headline: "No per-event cost", detail: null },
    },
    // Enterprise usage is billed per contract, so list pricing doesn't apply.
    showPricing: plan !== "enterprise",
    pricingFootnote: isPaidPlan
      ? null
      : "* The Starter plan is capped at the included limit. Upgrade to Pro to unlock usage-based billing above the included limit.",
  };
}
