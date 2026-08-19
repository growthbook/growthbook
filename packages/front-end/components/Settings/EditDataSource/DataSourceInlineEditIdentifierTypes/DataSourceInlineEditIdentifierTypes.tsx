import React, { FC, useCallback, useMemo, useState } from "react";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  UserIdType,
} from "shared/types/datasource";
import { isEventForwarderManagedUserIdType } from "shared/util";
import { PiPlus } from "react-icons/pi";
import { Box, Card, Flex } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import { EditIdentifierType } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentifierTypes/EditIdentifierType";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
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

  const userIdTypes = useMemo(
    () => dataSource.settings?.userIdTypes || [],
    [dataSource.settings?.userIdTypes],
  );

  const recordEditing = useMemo((): null | UserIdType => {
    return userIdTypes[editingIndex] || null;
  }, [editingIndex, userIdTypes]);

  // Names are fixed once created. For Event Forwarder managed types only the
  // description is editable; the linked hash attribute is managed for them.
  const isEditingEventForwarderManagedType = recordEditing
    ? isEventForwarderManagedUserIdType(recordEditing)
    : false;

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
      const types = copy.settings?.userIdTypes;
      if (!types) {
        return;
      }
      types.splice(idx, 1);

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
          uiMode === "edit" && isEditingEventForwarderManagedType;

        if (idx >= types.length) {
          types.push({ userIdType, description, attributes });
        } else {
          const existing = types[idx];
          if (!existing) {
            return;
          }
          // Managed: only description is editable. Otherwise spread existing so
          // reused types keep sourceAttribute / managedBy across edits.
          types[idx] = editingManagedType
            ? { ...existing, description }
            : {
                ...existing,
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
    [dataSource, isEditingEventForwarderManagedType, onSave, uiMode],
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
          <Heading as="h3" size="md" mb="0">
            Identifier Types
          </Heading>
          <Badge label={userIdTypes.length + ""} color="gray" radius="medium" />
        </Flex>
        <Box>
          <Button
            variant="solid"
            onClick={handleAdd}
            disabled={!canEdit}
            icon={<PiPlus />}
          >
            Add
          </Button>
        </Box>
      </Flex>
      <Text as="p" color="text-mid">
        The different units you use to split traffic in an experiment.
      </Text>

      {userIdTypes.map((type, idx) => {
        const { userIdType, description, attributes } = type;

        return (
          <Card key={userIdType} mt="3">
            <Flex align="start" justify="between" py="2" px="3" gap="3">
              {/* region Identity Type text */}
              <Box>
                <Flex align="center" gap="2" mb="1">
                  <Heading size="sm" as="h3" mb="0">
                    {userIdType}
                  </Heading>
                </Flex>
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
                <Flex gap="2">
                  <Button
                    variant="outline"
                    onClick={handleActionEditClicked(idx)}
                  >
                    Edit
                  </Button>
                  <DeleteButton
                    onClick={handleActionDeleteClicked(idx)}
                    useIcon={false}
                    displayName={userIdTypes[idx]?.userIdType}
                    deleteMessage={`Are you sure you want to delete identifier type ${userIdTypes[idx]?.userIdType}?`}
                    title="Delete"
                    text="Delete"
                  />
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
