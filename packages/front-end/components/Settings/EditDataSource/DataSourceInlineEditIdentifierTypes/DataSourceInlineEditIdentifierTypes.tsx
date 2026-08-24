import React, { FC, useCallback, useMemo, useState } from "react";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  UserIdType,
} from "shared/types/datasource";
import { isEventForwarderManaged } from "shared/util";
import { PiPlus } from "react-icons/pi";
import { Box, Card, Flex } from "@radix-ui/themes";
import { OfficialBadge } from "@/components/Metrics/MetricName";
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

        if (idx >= types.length) {
          types.push({ userIdType, description, attributes });
        } else {
          const existing = types[idx];
          if (!existing) {
            return;
          }
          // Spread existing so fields the form does not own survive the edit.
          types[idx] = { ...existing, userIdType, description, attributes };
        }

        if (!copy.settings) {
          copy.settings = {};
        }
        copy.settings.userIdTypes = types;

        await onSave(copy);
      },
    [dataSource, onSave],
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
        const isManaged = isEventForwarderManaged(type);

        return (
          <Card key={userIdType} mt="3">
            <Flex align="start" justify="between" py="2" px="3" gap="3">
              <Box>
                <Heading size="sm" as="h3" mb="1">
                  {userIdType}
                  {isManaged && (
                    <OfficialBadge
                      type="identifier type"
                      managedBy="api"
                      ml="1"
                    />
                  )}
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

              {canEdit && !isManaged && (
                <Flex gap="2">
                  <Button
                    variant="ghost"
                    onClick={handleActionEditClicked(idx)}
                  >
                    Edit
                  </Button>
                  <DeleteButton
                    onClick={handleActionDeleteClicked(idx)}
                    useIcon={false}
                    displayName={userIdType}
                    deleteMessage={`Are you sure you want to delete identifier type ${userIdType}?`}
                    title="Delete"
                    text="Delete"
                  />
                </Flex>
              )}
            </Flex>
          </Card>
        );
      })}

      {userIdTypes.length === 0 ? (
        <Callout status="info" mb="0">
          No user identifier types.
        </Callout>
      ) : null}

      {uiMode === "edit" || uiMode === "add" ? (
        <EditIdentifierType
          mode={uiMode}
          onCancel={handleCancel}
          userIdType={recordEditing?.userIdType ?? ""}
          description={recordEditing?.description}
          attributes={recordEditing?.attributes}
          onSave={handleSave(editingIndex)}
          dataSource={dataSource}
        />
      ) : null}
    </Box>
  );
};
