import React, { FC, useCallback, useMemo, useState } from "react";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  UserIdType,
} from "back-end/types/datasource";
import { FaPlus } from "react-icons/fa";
import { Box, Card, Flex, Heading } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import { EditIdentifierType } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentifierTypes/EditIdentifierType";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";

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
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      copy.settings.userIdTypes.splice(idx, 1);

      await onSave(copy);
    },
    [onSave, dataSource],
  );

  const handleSave = useCallback(
    (idx: number) => async (userIdType: string, description: string) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      copy.settings.userIdTypes[idx] = {
        userIdType,
        description,
      };

      await onSave(copy);
    },
    [dataSource, onSave],
  );

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(userIdTypes.length);
  }, [userIdTypes]);

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <Box>
      <Flex align="center" gap="2" justify="between" mb="3">
        <Flex align="center" gap="3" mb="0">
          <Heading as="h3" size="4" mb="0">
            Identifier Types
          </Heading>
          <Badge label={userIdTypes.length + ""} color="gray" radius="medium" />
        </Flex>
        {canEdit && (
          <Box>
            <Button variant="solid" onClick={handleAdd}>
              <FaPlus className="mr-1" /> Add
            </Button>
          </Box>
        )}
      </Flex>
      <p>The different units you use to split traffic in an experiment.</p>

      {userIdTypes.map(({ userIdType, description }, idx) => (
        <Card key={userIdType} mt="3">
          <Flex align="start" justify="between" py="2" px="3" gap="3">
            {/* region Identity Type text */}
            <Box>
              <Heading size="3" as="h3">
                {userIdType}
              </Heading>
              <span className="text-muted">
                {description || "(no description)"}
              </span>
            </Box>
            {/* endregion Identity Type text */}

            {/* region Identity Type actions */}
            {canEdit && (
              <Flex gap="3">
                <DeleteButton
                  onClick={handleActionDeleteClicked(idx)}
                  useRadix={true}
                  useIcon={false}
                  displayName={userIdTypes[idx]?.userIdType}
                  deleteMessage={`Are you sure you want to delete identifier type ${userIdTypes[idx]?.userIdType}?`}
                  title="Delete"
                  text="Delete"
                  outline={false}
                />
                <Button variant="ghost" onClick={handleActionEditClicked(idx)}>
                  Edit
                </Button>
              </Flex>
            )}
            {/* endregion Identity Type actions */}
          </Flex>
        </Card>
      ))}

      {/* region Identity Type empty state */}
      {userIdTypes.length === 0 ? (
        <div className="mb-0 alert alert-info">No user identifier types.</div>
      ) : null}
      {/* endregion Identity Type empty state */}

      {/* region Add/Edit modal */}
      {uiMode === "edit" || uiMode === "add" ? (
        <EditIdentifierType
          mode={uiMode}
          onCancel={handleCancel}
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
          userIdType={recordEditing?.userIdType}
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
          description={recordEditing?.description}
          onSave={handleSave(editingIndex)}
          dataSource={dataSource}
        />
      ) : null}
      {/* endregion Add/Edit modal */}
    </Box>
  );
};
