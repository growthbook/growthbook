import React, { FC, useCallback, useMemo, useState } from "react";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  UserIdType,
} from "shared/types/datasource";
import { isEventForwarderManagedIdentifierId } from "shared/util";
import { FaPlus } from "react-icons/fa";
import { Box, Card, Flex } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import { EditIdentifierType } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentifierTypes/EditIdentifierType";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CounterBadge from "@/ui/Badge/CounterBadge";
import Button from "@/ui/Button";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";

type DataSourceInlineEditIdentifierTypesProps =
  DataSourceQueryEditingModalBaseProps;

export const DataSourceInlineEditIdentifierTypes: FC<
  DataSourceInlineEditIdentifierTypesProps
> = ({ dataSource, onSave, onCancel, canEdit = true }) => {
  const [uiMode, setUiMode] = useState<"view" | "edit" | "add">("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);

  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const eventForwarderActive = Boolean(dataSource.eventForwarderConfig);

  const userIdTypes = useMemo(
    () => dataSource.settings?.userIdTypes || [],
    [dataSource.settings?.userIdTypes],
  );

  // Only Event Forwarder managed identifier types (prefixed with `ef_`) are
  // locked. User-created identifier types that happen to use the same hash
  // attribute remain editable / deletable.
  const isEventForwarderManagedType = useCallback(
    (userIdType: string) =>
      eventForwarderActive && isEventForwarderManagedIdentifierId(userIdType),
    [eventForwarderActive],
  );

  const recordEditing = useMemo((): null | UserIdType => {
    return userIdTypes[editingIndex] || null;
  }, [editingIndex, userIdTypes]);

  const isEditingEventForwarderManagedType = useMemo(
    () =>
      recordEditing
        ? isEventForwarderManagedType(recordEditing.userIdType)
        : false,
    [isEventForwarderManagedType, recordEditing],
  );

  const handleCancel = useCallback(() => {
    setUiMode("view");
    setEditingIndex(-1);
    onCancel();
  }, [onCancel]);

  const handleActionEditClicked = useCallback(
    (idx: number) => () => {
      setEditingIndex(idx);
      setUiMode("edit");
    },
    [],
  );

  const handleActionDeleteClicked = useCallback(
    (idx: number) => async () => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      copy.settings.userIdTypes.splice(idx, 1);

      await onSave(copy);
    },
    [onSave, dataSource],
  );

  const handleSave = useCallback(
    (idx: number) =>
      async (userIdType: string, description: string, attributes: string[]) => {
        const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
        const types = copy.settings?.userIdTypes ?? [];
        const editingManagedType =
          uiMode === "edit" && isEventForwarderManagedType(userIdType);

        if (idx >= types.length) {
          types.push({ userIdType, description, attributes });
        } else {
          const existing = types[idx];
          if (!existing) {
            return;
          }
          types[idx] = editingManagedType
            ? { ...existing, description }
            : {
                userIdType,
                description,
                attributes,
              };
        }

        if (!copy.settings) {
          copy.settings = {};
        }
        copy.settings.userIdTypes = types;

        await onSave(copy);
      },
    [dataSource, isEventForwarderManagedType, onSave, uiMode],
  );

  const handleAdd = useCallback(() => {
    setEditingIndex(userIdTypes.length);
    setUiMode("add");
  }, [userIdTypes]);

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <Box>
      <Flex align="center" gap="2" justify="between" mb="3">
        <Flex align="center" gap="3" mb="0">
          <Heading as="h3" size="medium" mb="0">
            Identifier Types
          </Heading>
          <CounterBadge color="neutral" count={userIdTypes.length} />
        </Flex>
        <Box>
          <Button variant="solid" onClick={handleAdd} disabled={!canEdit}>
            <FaPlus className="mr-1" /> Add
          </Button>
        </Box>
      </Flex>
      <p>The different units you use to split traffic in an experiment.</p>

      {userIdTypes.map(({ userIdType, description, attributes }, idx) => {
        const deleteDisabled = isEventForwarderManagedType(userIdType);

        return (
          <Card key={userIdType} mt="3">
            <Flex align="start" justify="between" py="2" px="3" gap="3">
              {/* region Identity Type text */}
              <Box>
                <Heading size="small" as="h3" mb="1">
                  {userIdType}
                </Heading>
                <Box mb="2">
                  <Metadata
                    label="Linked Hash Attributes"
                    value={attributes?.join(", ") || "None"}
                  />
                </Box>
                <Text color="text-mid">
                  {description || "(no description)"}
                </Text>
              </Box>
              {/* endregion Identity Type text */}

              {/* region Identity Type actions */}
              {canEdit && (
                <Flex gap="3">
                  {!deleteDisabled && (
                    <DeleteButton
                      onClick={handleActionDeleteClicked(idx)}
                      useIcon={false}
                      displayName={userIdTypes[idx]?.userIdType}
                      deleteMessage={`Are you sure you want to delete identifier type ${userIdTypes[idx]?.userIdType}?`}
                      title="Delete"
                      text="Delete"
                      outline={false}
                      disabled={deleteDisabled}
                    />
                  )}
                  <Button
                    variant="ghost"
                    onClick={handleActionEditClicked(idx)}
                  >
                    Edit
                  </Button>
                </Flex>
              )}
              {/* endregion Identity Type actions */}
            </Flex>
          </Card>
        );
      })}

      {/* region Identity Type empty state */}
      {userIdTypes.length === 0 ? (
        <Callout status="info" mb="0">
          No user identifier types.
        </Callout>
      ) : null}
      {/* endregion Identity Type empty state */}

      {/* region Add/Edit modal */}
      {uiMode === "edit" || uiMode === "add" ? (
        <EditIdentifierType
          mode={uiMode}
          onCancel={handleCancel}
          userIdType={recordEditing?.userIdType ?? ""}
          description={recordEditing?.description}
          attributes={recordEditing?.attributes}
          onSave={handleSave(editingIndex)}
          dataSource={dataSource}
          isEventForwarderManagedType={isEditingEventForwarderManagedType}
        />
      ) : null}
      {/* endregion Add/Edit modal */}
    </Box>
  );
};
