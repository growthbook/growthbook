import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { ALL_ENVIRONMENTS_TAKEN_MESSAGE } from "./EventForwarderDestinationFields";

export type DataSourceOptionKey = "managed" | "event-forwarder" | "custom";

export type DataSourceOptionAvailability =
  | { status: "available" }
  | { status: "already-set-up"; datasourceId: string }
  | { status: "upgrade-required" }
  | { status: "cloud-only"; reason: string }
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

const CLOUD_ONLY: DataSourceOptionAvailability = {
  status: "cloud-only",
  reason: "Only available on GrowthBook Cloud.",
};

// - Both require usage-based billing
// - Managed Warehouse is one per organization; Event Forwarders are one per environment
function getEventPipelineAvailability({
  name,
  existingId,
  existsInOrg,
  canCreate,
  isLegacyProPlan,
  hasCommercialFeature,
  unavailableReason,
}: {
  name: string;
  existingId: string | undefined;
  existsInOrg: boolean;
  canCreate: boolean;
  isLegacyProPlan: boolean;
  hasCommercialFeature: boolean;
  // Another one cannot be added right now
  unavailableReason?: string;
}): DataSourceOptionAvailability {
  if (existingId) return { status: "already-set-up", datasourceId: existingId };
  if (existsInOrg) {
    return {
      status: "unavailable",
      reason: `Your organization already has ${name}, but you do not have access.`,
    };
  }
  if (!isCloud()) return CLOUD_ONLY;
  if (!canCreate) return NO_PERMISSION;
  if (isLegacyProPlan) return LEGACY_PRO_PLAN;
  if (!hasCommercialFeature) return { status: "upgrade-required" };
  if (unavailableReason) {
    return { status: "unavailable", reason: unavailableReason };
  }
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
    eventForwarderEnvironments,
  } = useDefinitions();
  const environments = useEnvironments();
  // No environment left for a new forwarder, so say so before the connection form
  const noFreeEnvironmentReason = eventForwarderEnvironments.some(
    (e) => !e.environment,
  )
    ? ALL_ENVIRONMENTS_TAKEN_MESSAGE
    : environments.every((env) =>
          eventForwarderEnvironments.some((e) => e.environment === env.id),
        )
      ? "Every environment already has an Event Forwarder. Add an environment, or change or delete an existing Event Forwarder."
      : undefined;
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
      existingId: undefined,
      existsInOrg: false,
      canCreate,
      isLegacyProPlan,
      hasCommercialFeature: hasCommercialFeature("events-forwarder"),
      unavailableReason: noFreeEnvironmentReason,
    }),
    custom: canCreate ? { status: "available" } : NO_PERMISSION,
  };
}
