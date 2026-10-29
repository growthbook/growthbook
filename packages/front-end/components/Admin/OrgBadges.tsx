import { AccountPlan, AdminOrgStatus } from "shared/enterprise";
import Badge from "@/ui/Badge";

const PLANS: Record<
  AccountPlan,
  { label: string; color: "gray" | "violet" | "amber" }
> = {
  oss: { label: "Open source", color: "gray" },
  starter: { label: "Starter", color: "gray" },
  pro: { label: "Pro", color: "violet" },
  pro_sso: { label: "Pro + SSO", color: "violet" },
  enterprise: { label: "Enterprise", color: "amber" },
};

const STATUSES: Record<
  AdminOrgStatus,
  { label: string; color: "green" | "blue" | "red" | "gray" | "amber" }
> = {
  active: { label: "Active", color: "green" },
  trialing: { label: "Trial", color: "blue" },
  past_due: { label: "Past due", color: "red" },
  canceled: { label: "Canceled", color: "gray" },
  suspended: { label: "Suspended", color: "amber" },
  disabled: { label: "Disabled", color: "red" },
};

export function PlanBadge({
  plan,
  legacy,
}: {
  plan: AccountPlan;
  legacy?: boolean;
}) {
  const { label, color } = PLANS[plan];
  return <Badge label={legacy ? `${label} (legacy)` : label} color={color} />;
}

export function StatusBadge({ status }: { status: AdminOrgStatus }) {
  const { label, color } = STATUSES[status];
  return <Badge label={label} color={color} />;
}
