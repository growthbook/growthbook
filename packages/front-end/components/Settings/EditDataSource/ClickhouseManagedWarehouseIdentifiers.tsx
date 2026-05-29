import { Box, Flex } from "@radix-ui/themes";
import { GrowthbookClickhouseDataSourceWithParams } from "shared/types/datasource";
import { getManagedWarehouseUserIdTypes } from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

// Read-only identifiers view for JSON-column managed warehouses. Identifiers are
// derived from the org's attributes (those marked as identifiers); every other
// attribute is queryable directly from the `attributes` JSON column, so there is
// nothing to configure here (this replaces the legacy materialized-columns editor).
export default function ClickhouseManagedWarehouseIdentifiers({
  dataSource,
}: {
  dataSource: GrowthbookClickhouseDataSourceWithParams;
}) {
  const settings = useOrgSettings();

  const identifiers =
    dataSource.settings.userIdTypes?.map((u) => u.userIdType) ??
    getManagedWarehouseUserIdTypes(settings.attributeSchema);

  return (
    <Box>
      <Heading as="h3" size="medium">
        Identifiers
      </Heading>
      <Text as="p" color="text-mid">
        These attributes uniquely identify users and are exposed as top-level
        columns in your warehouse fact tables for experiment analysis.
      </Text>
      <Flex gap="2" wrap="wrap" my="3">
        {identifiers.length ? (
          identifiers.map((id) => <Badge key={id} label={id} color="violet" />)
        ) : (
          <Text color="text-mid">No identifiers configured.</Text>
        )}
      </Flex>
      <Callout status="info">
        Identifiers are managed through your organization&apos;s{" "}
        <Link href="/attributes">attributes</Link> (those marked as
        identifiers). Every other attribute your SDK sends is automatically
        queryable from the <code>attributes</code> JSON column on your fact
        tables&mdash;no setup required.
      </Callout>
    </Box>
  );
}
