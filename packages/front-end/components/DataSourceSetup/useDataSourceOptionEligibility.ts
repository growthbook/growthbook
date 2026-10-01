import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export type DataSourceOptionKey = "managed" | "event-forwarder" | "custom";

type DataSourceOptionAvailability =
  | { status: "available" }
  | { status: "already-set-up"; datasourceId: string }
  | { status: "upgrade-required" }
  | { status: "unavailable"; reason: string };

type DataSourceOptionEligibility = {
  availability: DataSourceOptionAvailability;
  pricing: { headline: string; detail: string | null };
};

const NO_PERMISSION: DataSourceOptionAvailability = {
  status: "unavailable",
  reason: "You don't have permission to add Data Sources in this project.",
};

const LEGACY_PRO_PLAN: DataSourceOptionAvailability = {
  status: "unavailable",
  reason:
    "Your Pro plan doesn't support this feature. Reach out to support@growthbook.io for more info.",
};

export function useDataSourceOptionEligibility(): {
  options: Record<DataSourceOptionKey, DataSourceOptionEligibility>;
  pricingFootnote: string | null;
} {
  const { datasources, project, projects } = useDefinitions();
  const { effectiveAccountPlan, license, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const canCreate = permissionsUtil.canViewCreateDataSourceModal(
    project,
    projects,
  );
  const plan = effectiveAccountPlan || "";
  const isPaidPlan = ["pro", "pro_sso", "enterprise"].includes(plan);
  // Pro plans not on Orb are older Stripe subscriptions, which can't be billed for event usage.
  const isLegacyProPlan =
    ["pro", "pro_sso"].includes(plan) &&
    !license?.isTrial &&
    !license?.orbSubscription;

  const existingManagedWarehouse = datasources.find(
    (d) => d.type === "growthbook_clickhouse",
  );

  let managed: DataSourceOptionAvailability;
  if (existingManagedWarehouse) {
    managed = {
      status: "already-set-up",
      datasourceId: existingManagedWarehouse.id,
    };
  } else if (!canCreate) {
    managed = NO_PERMISSION;
  } else if (isLegacyProPlan) {
    managed = LEGACY_PRO_PLAN;
  } else {
    managed = { status: "available" };
  }

  const existingEventForwarder = datasources.find(
    (d) => d.eventForwarderConfig,
  );

  let eventForwarder: DataSourceOptionAvailability;
  if (existingEventForwarder) {
    eventForwarder = {
      status: "already-set-up",
      datasourceId: existingEventForwarder.id,
    };
  } else if (!canCreate) {
    eventForwarder = NO_PERMISSION;
  } else if (isLegacyProPlan) {
    eventForwarder = LEGACY_PRO_PLAN;
  } else if (hasCommercialFeature("events-forwarder")) {
    eventForwarder = { status: "available" };
  } else {
    eventForwarder = { status: "upgrade-required" };
  }

  const overageDetail = "then $30/M events";

  return {
    options: {
      managed: {
        availability: managed,
        pricing: {
          headline: `${isPaidPlan ? "2M" : "1M"} events/month included`,
          detail: `${overageDetail}${isPaidPlan ? "" : "*"}`,
        },
      },
      "event-forwarder": {
        availability: eventForwarder,
        pricing: {
          headline: "2M events/month included",
          detail: overageDetail,
        },
      },
      custom: {
        availability: canCreate ? { status: "available" } : NO_PERMISSION,
        pricing: { headline: "No per-event cost", detail: null },
      },
    },
    pricingFootnote: isPaidPlan
      ? null
      : "* The Starter plan is capped at the included limit. Upgrade to Pro to unlock usage-based billing above the included limit.",
  };
}
