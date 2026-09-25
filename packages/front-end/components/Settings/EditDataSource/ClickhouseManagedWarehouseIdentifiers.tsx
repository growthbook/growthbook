import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { GrowthbookClickhouseDataSourceWithParams } from "shared/types/datasource";
import {
  getManagedWarehouseUserIdTypes,
  ManagedWarehouseIdAttributeIdentifier,
} from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
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

  const idAttributeIdentifier: ManagedWarehouseIdAttributeIdentifier =
    dataSource.settings.idAttributeIdentifier === "user_id"
      ? "user_id"
      : "device_id";
  const [pendingIdIdentifier, setPendingIdIdentifier] =
    useState<ManagedWarehouseIdAttributeIdentifier | null>(null);
  // Nothing to map unless the org actually assigns on `id`. Still shown when the
  // setting is already non-default, so it stays visible and revertable.
  const showIdAttributeMapping =
    idAttributeIdentifier === "user_id" ||
    (settings.attributeSchema ?? []).some(
      (a) => a.property === "id" && a.hashAttribute && !a.archived,
    );

  const removeIdentifier = async (identifier: string) => {
    await apiCall(
      `/datasource/${dataSource.id}/managed-warehouse/remove-legacy-identifier`,
      { method: "POST", body: JSON.stringify({ identifier }) },
    );
    mutate?.();
  };

  const saveIdIdentifier = async (
    identifier: ManagedWarehouseIdAttributeIdentifier,
  ) => {
    await apiCall(
      `/datasource/${dataSource.id}/managed-warehouse/id-attribute-identifier`,
      { method: "PUT", body: JSON.stringify({ identifier }) },
    );
    setPendingIdIdentifier(null);
    mutate?.();
  };

  return (
    <Box>
      <Heading as="h3" size="md">
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
      {dataSource.settings.useJsonColumns && showIdAttributeMapping ? (
        <Box mt="4" maxWidth="420px">
          <Select
            label={
              <Text as="label" weight="semibold">
                The <code>id</code> attribute maps to
              </Text>
            }
            value={idAttributeIdentifier}
            setValue={(v) => {
              if (v !== idAttributeIdentifier) {
                setPendingIdIdentifier(
                  v === "user_id" ? "user_id" : "device_id",
                );
              }
            }}
            disabled={!canEdit}
          >
            <SelectItem value="device_id">
              device_id &mdash; anonymous or device IDs (default)
            </SelectItem>
            <SelectItem value="user_id">
              user_id &mdash; logged-in user IDs (Ingestion API only)
            </SelectItem>
          </Select>
          {idAttributeIdentifier === "user_id" ? (
            <HelperText status="warning" mt="1">
              <span>
                Applies to Ingestion API events only&mdash;SDKs using the
                tracking plugin always fold <code>id</code> into{" "}
                <code>device_id</code> on the client, out of reach of this
                setting.
              </span>
            </HelperText>
          ) : null}
        </Box>
      ) : null}
      {pendingIdIdentifier ? (
        <ConfirmDialog
          title={`Map the id attribute to ${pendingIdIdentifier}`}
          content={
            <>
              <Text as="p">
                Generated SQL will resolve the <code>id</code> attribute as{" "}
                <code>{pendingIdIdentifier}</code> instead of{" "}
                <code>{idAttributeIdentifier}</code>. This regenerates this Data
                Source&apos;s assignment queries and fact-table SQL. Experiments
                assigned on the <code>id</code> attribute will need their
                assignment query switched to <code>{pendingIdIdentifier}</code>{" "}
                and their results updated.
              </Text>
              {pendingIdIdentifier === "user_id" ? (
                <Text as="p" mt="2">
                  Only use this if you send events through the Ingestion API
                  with a logged-in user ID under the <code>id</code> key. SDKs
                  using the tracking plugin fold <code>id</code> into the{" "}
                  <code>device_id</code> column on the client, where this
                  setting cannot reach it&mdash;with the plugin, keep the
                  default.
                </Text>
              ) : null}
            </>
          }
          yesText="Change mapping"
          onConfirm={() => saveIdIdentifier(pendingIdIdentifier)}
          onCancel={() => setPendingIdIdentifier(null)}
        />
      ) : null}
    </Box>
  );
}
