import { useAuth } from "@/services/auth";
import UpgradeModal from "@/components/Settings/UpgradeModal";

// Pricing Phase 1: renders the global upgrade modal when an API call hit a
// soft plan limit (402 plan_limit_exceeded). The trigger lives on the auth
// context (set inside apiCall), but this must render inside UserContextProvider
// because UpgradeModal reads org context via useUser(). Mounted once, high in
// the org app (next to InAppHelp in ProtectedPage). commercialFeature is null:
// this is a plan-tier upsell, not a single premium feature.
export default function PlanLimitUpgradeModal() {
  const { planLimitUpgrade, dismissPlanLimitUpgrade } = useAuth();

  if (!planLimitUpgrade) return null;

  return (
    <UpgradeModal
      close={dismissPlanLimitUpgrade}
      source={planLimitUpgrade.source}
      commercialFeature={null}
    />
  );
}
