import {
  MANAGED_WAREHOUSE_MIGRATING_MESSAGE,
  MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE,
  isManagedWarehouseMigrating,
} from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DocLink } from "@/components/DocLink";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

export default function ManagedWarehouseNoEventsCallout({
  size = "md",
}: {
  size?: "sm" | "md";
}) {
  const { datasources } = useDefinitions();
  // A provisioned warehouse mid-migration shows "upgrading" copy instead of the
  // never-provisioned onboarding message. There's one managed warehouse per org.
  const migrating = datasources.some((d) => isManagedWarehouseMigrating(d));

  if (migrating) {
    return (
      <Callout status="info" size={size}>
        <Text size={size}>{MANAGED_WAREHOUSE_MIGRATING_MESSAGE}</Text>
      </Callout>
    );
  }

  return (
    <Callout status="info" size={size}>
      <Text size={size}>
        {MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE} Read{" "}
        <DocLink docSection="managedWarehouseTracking">our full docs</DocLink>{" "}
        with instructions on how to send events from your app to GrowthBook.
      </Text>
    </Callout>
  );
}
