import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export type DataSourceOptionKey = "managed" | "event-forwarder" | "custom";

export type DataSourceOptionAvailability =
  | { status: "available" }
  | { status: "already-set-up"; datasourceId: string }
  | { status: "upgrade-required" }
  | { status: "unavailable"; reason: string };

const NO_PERMISSION: DataSourceOptionAvailability = {
  status: "unavailable",
  reason: "You don't have permission to add Data Sources in this project.",
};

const LEGACY_PRO_PLAN: DataSourceOptionAvailability = {
  status: "unavailable",
  reason:
    "Your Pro plan doesn't support this feature. Reach out to support@growthbook.io for more info.",
};

// Managed Warehouse and Event Forwarder are limited to one per organization,
// and both require usage-based billing.
function getEventPipelineAvailability({
  name,
  existingId,
  existsInOrg,
  canCreate,
  isLegacyProPlan,
  hasCommercialFeature,
}: {
  name: string;
  existingId: string | undefined;
  existsInOrg: boolean;
  canCreate: boolean;
  isLegacyProPlan: boolean;
  hasCommercialFeature: boolean;
}): DataSourceOptionAvailability {
  if (existingId) return { status: "already-set-up", datasourceId: existingId };
  if (existsInOrg) {
    return {
      status: "unavailable",
      reason: `Your organization already has ${name}, but you do not have access.`,
    };
  }
  if (!canCreate) return NO_PERMISSION;
  if (isLegacyProPlan) return LEGACY_PRO_PLAN;
  if (!hasCommercialFeature) return { status: "upgrade-required" };
  return { status: "available" };
}

export function useDataSourceOptionEligibility(): Record<
  DataSourceOptionKey,
  DataSourceOptionAvailability
> {
  const {
    datasources,
    project,
    projects,
    hasManagedWarehouse,
    hasEventForwarder,
  } = useDefinitions();
  const { effectiveAccountPlan, license, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const canCreate = permissionsUtil.canViewCreateDataSourceModal(
    project,
    projects,
  );
  const plan = effectiveAccountPlan || "";
  // Pro plans not on Orb are older Stripe subscriptions, which can't be billed for event usage.
  const isLegacyProPlan =
    ["pro", "pro_sso"].includes(plan) &&
    !license?.isTrial &&
    !license?.orbSubscription;

  return {
    managed: getEventPipelineAvailability({
      name: "a Managed Warehouse",
      existingId: datasources.find((d) => d.type === "growthbook_clickhouse")
        ?.id,
      existsInOrg: hasManagedWarehouse,
      canCreate,
      isLegacyProPlan,
      hasCommercialFeature: true,
    }),
    "event-forwarder": getEventPipelineAvailability({
      name: "an Event Forwarder",
      existingId: datasources.find((d) => d.eventForwarderConfig)?.id,
      existsInOrg: hasEventForwarder,
      canCreate,
      isLegacyProPlan,
      hasCommercialFeature: hasCommercialFeature("events-forwarder"),
    }),
    custom: canCreate ? { status: "available" } : NO_PERMISSION,
  };
}
