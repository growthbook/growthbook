import { useUser } from "@/services/UserContext";

export default function AccountPlanBadge() {
  const { effectiveAccountPlan, organization } = useUser();

  // When organization is disabled (deactivated), show red deactivated badge
  if (organization?.disabled) {
    return (
      <span className="badge badge-pill badge-danger mr-1">DEACTIVATED</span>
    );
  }

  const badgeText =
    effectiveAccountPlan === "enterprise"
      ? "ENTERPRISE"
      : effectiveAccountPlan === "pro"
        ? "PRO"
        : effectiveAccountPlan === "pro_sso"
          ? "PRO + SSO"
          : "";

  if (!badgeText) return null;

  const color =
    effectiveAccountPlan === "enterprise" ? "badge-dark" : "badge-primary";

  return <span className={`badge badge-pill ${color} mr-1`}>{badgeText}</span>;
}
