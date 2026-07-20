import {
  MANAGED_WAREHOUSE_MIGRATING_MESSAGE,
  MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE,
  MANAGED_WAREHOUSE_SENDING_EVENTS_DOC_URL,
  isManagedWarehouseMigrating,
} from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function ManagedWarehouseNoEventsCallout() {
  const { datasources } = useDefinitions();
  // A provisioned warehouse mid-migration shows "upgrading" copy instead of the
  // never-provisioned onboarding message. There's one managed warehouse per org.
  const migrating = datasources.some((d) => isManagedWarehouseMigrating(d));

  if (migrating) {
    return (
      <Callout status="info">
        <Text>{MANAGED_WAREHOUSE_MIGRATING_MESSAGE}</Text>
      </Callout>
    );
  }

  return (
    <Callout status="info">
      <Text>
        {MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE} Read{" "}
        <Link
          href={MANAGED_WAREHOUSE_SENDING_EVENTS_DOC_URL}
          target="_blank"
          rel="noreferrer"
        >
          our full docs
        </Link>{" "}
        with instructions on how to send events from your app to GrowthBook.
      </Text>
    </Callout>
  );
}
