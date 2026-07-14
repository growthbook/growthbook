import { Box, Flex } from "@radix-ui/themes";
import { GrowthbookClickhouseDataSourceWithParams } from "shared/types/datasource";
import { getManagedWarehouseUserIdTypes } from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

// Identifiers view for JSON-column managed warehouses. Identifiers come from the org's
// attributes; every other attribute is queryable from `attributes`. Legacy identifiers
// preserved from a past migration (in `migratedIdentifiers`, no longer among the org's
// attributes) can be removed here — nothing else exposes them.
export default function ClickhouseManagedWarehouseIdentifiers({
  dataSource,
  canEdit = false,
  mutate,
}: {
  dataSource: GrowthbookClickhouseDataSourceWithParams;
  canEdit?: boolean;
  mutate?: () => void;
}) {
  const settings = useOrgSettings();
  const { apiCall } = useAuth();

  const identifiers =
    dataSource.settings.userIdTypes?.map((u) => u.userIdType) ??
    getManagedWarehouseUserIdTypes(settings.attributeSchema);

  const legacy = new Set(dataSource.settings.migratedIdentifiers ?? []);
  const hasLegacy = identifiers.some((id) => legacy.has(id));

  const removeIdentifier = async (identifier: string) => {
    await apiCall(
      `/datasource/${dataSource.id}/managed-warehouse/remove-legacy-identifier`,
      { method: "POST", body: JSON.stringify({ identifier }) },
    );
    mutate?.();
  };

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
          identifiers.map((id) =>
            legacy.has(id) ? (
              <Flex key={id} align="center" gap="1">
                <Badge label={id} color="gray" />
                {canEdit ? (
                  <DeleteButton
                    useRadix={false}
                    useIcon={true}
                    link={true}
                    displayName={id}
                    title={`Delete legacy identifier "${id}"`}
                    deleteMessage={`Delete the legacy identifier "${id}"? It was preserved from a past migration and is no longer one of your attributes. It will stop being selectable and be removed from your warehouse fact tables. Any experiment still using it will need a different identifier.`}
                    onClick={() => removeIdentifier(id)}
                  />
                ) : null}
              </Flex>
            ) : (
              <Badge key={id} label={id} color="violet" />
            ),
          )
        ) : (
          <Text color="text-mid">No identifiers configured.</Text>
        )}
      </Flex>
      <Callout status="info">
        Identifiers are managed through your organization&apos;s{" "}
        <Link href="/attributes">attributes</Link> (those marked as
        identifiers). Every other attribute your SDK sends is automatically
        queryable from the <code>attributes</code>
        <span> </span>JSON column on your fact tables&mdash;no setup required.
        {hasLegacy ? (
          <>
            {" "}
            Identifiers shown in gray were preserved from a past migration and
            are no longer among your attributes
            {canEdit ? <>&mdash;delete any you no longer need</> : null}.
          </>
        ) : null}
      </Callout>
    </Box>
  );
}
