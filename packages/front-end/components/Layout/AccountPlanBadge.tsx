import { useUser } from "@/services/UserContext";

export default function AccountPlanBadge() {
  const { accountPlan } = useUser();

  const badgeText =
    accountPlan === "enterprise"
      ? "ENTERPRISE"
      : accountPlan === "pro"
      ? "PRO"
      : accountPlan === "pro_sso"
      ? "PRO + SSO"
      : "";

  if (!badgeText) return null;

  const color = accountPlan === "enterprise" ? "badge-dark" : "badge-primary";

  return <span className={`badge badge-pill ${color} mr-1`}>{badgeText}</span>;
}
