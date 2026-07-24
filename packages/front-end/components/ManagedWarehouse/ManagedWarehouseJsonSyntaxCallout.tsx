import {
  MANAGED_WAREHOUSE_JSON_SYNTAX_DOC_URL,
  MANAGED_WAREHOUSE_JSON_SYNTAX_MESSAGE,
} from "shared/util";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

// Shown when a query throws ManagedWarehouseJsonSyntaxError (see ClickHouse.ts).
export default function ManagedWarehouseJsonSyntaxCallout() {
  return (
    <Callout status="info">
      <Text>
        {MANAGED_WAREHOUSE_JSON_SYNTAX_MESSAGE} See{" "}
        <Link
          href={MANAGED_WAREHOUSE_JSON_SYNTAX_DOC_URL}
          target="_blank"
          rel="noreferrer"
        >
          querying attributes and properties
        </Link>{" "}
        for examples.
      </Text>
    </Callout>
  );
}
