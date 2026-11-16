import {
  MANAGED_WAREHOUSE_NO_EVENTS_MESSAGE,
  MANAGED_WAREHOUSE_SENDING_EVENTS_DOC_URL,
} from "shared/util";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function ManagedWarehouseNoEventsCallout({
  size = "md",
}: {
  size?: "sm" | "md";
}) {
  return (
    <Callout status="info" size={size}>
      <Text size={size}>
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
