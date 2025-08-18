import { GrowthbookClickhouseDataSourceWithParams } from "back-end/types/datasource";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";

export default function useManagedWarehouse(): {
  hasManagedWarehouse: boolean;
  managedDatasource?: GrowthbookClickhouseDataSourceWithParams;
  canAddManagedWarehouse: boolean;
} {
  const gb = useGrowthBook();
  const { datasources } = useDefinitions();
  const { hasCommercialFeature, license, permissionsUtil } = useUser();

  const managedDatasource = datasources.find(
    (d) => d.type === "growthbook_clickhouse"
  );

  const canAdd = (() => {
    // Cloud-only
    if (!isCloud()) {
      return false;
    }

    // Need permission to create data sources
    if (!permissionsUtil.canViewCreateDataSourceModal()) {
      return false;
    }

    // Feature flag gating
    if (!gb.isOn("inbuilt-data-warehouse")) {
      return false;
    }

    // Only 1 managed warehouse allowed per org
    if (managedDatasource) {
      return false;
    }

    // Cannot be on a non-usage-based paid plan
    // TODO: Migration process from Stripe to Orb to enable this use case
    if (
      hasCommercialFeature("managed-warehouse") &&
      !license?.orbSubscription &&
      !license?.isTrial
    ) {
      return false;
    }

    // Otherwise, it is allowed
    return true;
  })();

  return {
    hasManagedWarehouse: !!managedDatasource,
    managedDatasource,
    canAddManagedWarehouse: canAdd,
  };
}
