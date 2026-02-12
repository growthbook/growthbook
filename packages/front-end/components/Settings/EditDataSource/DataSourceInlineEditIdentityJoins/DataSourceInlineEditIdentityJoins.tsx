import React, { FC, useCallback, useMemo, useState } from "react";
import { FaChevronRight, FaPlus } from "react-icons/fa";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  IdentityJoinQuery,
} from "shared/types/datasource";
import { Box, Card, Flex } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import { AddEditIdentityJoinModal } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentityJoins/AddEditIdentityJoinModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Code from "@/components/SyntaxHighlighting/Code";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";

type DataSourceInlineEditIdentityJoinsProps =
  DataSourceQueryEditingModalBaseProps;

export const DataSourceInlineEditIdentityJoins: FC<
  DataSourceInlineEditIdentityJoinsProps
> = ({ dataSource, onSave, onCancel, canEdit = true }) => {
  const [uiMode, setUiMode] = useState<"view" | "edit" | "add">("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);

  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const [openIndexes, setOpenIndexes] = useState<boolean[]>(
    Array.from(
      Array(dataSource?.settings?.queries?.identityJoins?.length || 0),
    ).fill(true),
  );

  const handleCancel = useCallback(() => {
    setUiMode("view");
    setEditingIndex(-1);
    onCancel();
  }, [onCancel]);

  const handleExpandCollapseForIndex = useCallback(
    (index) => () => {
      const currentValue = openIndexes[index] || false;
      const updatedOpenIndexes = [...openIndexes];
      updatedOpenIndexes[index] = !currentValue;

      setOpenIndexes(updatedOpenIndexes);
    },
    [openIndexes],
  );

  const userIdTypes = useMemo(
    () => dataSource.settings?.userIdTypes || [],
    [dataSource.settings?.userIdTypes],
  );
  const addIsDisabled = userIdTypes.length < 2;
  const identityJoins = useMemo(
    () => dataSource?.settings?.queries?.identityJoins || [],
    [dataSource?.settings?.queries?.identityJoins],
  );

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(identityJoins.length);
  }, [identityJoins]);

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
      copy.settings.queries.identityJoins.splice(idx, 1);

      await onSave(copy);
    },
    [onSave, dataSource],
  );

  const handleSave = useCallback(
    (idx: number) => async (identityJoin: IdentityJoinQuery) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      copy.settings.queries.identityJoins[idx] = identityJoin;
      await onSave(copy);
    },
    [dataSource, onSave],
  );

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <Box>
      {/* region Heading */}
      {identityJoins.length > 0 || userIdTypes.length >= 2 ? (
        <>
          <Flex align="center" gap="2" justify="between" mb="3">
            <Flex align="center" gap="3" mb="0">
              <Heading as="h3" size="medium" mb="0">
                Join Tables
              </Heading>
              <Badge
                label={identityJoins.length + ""}
                color="gray"
                radius="medium"
              />
            </Flex>
            {canEdit && (
              <Box>
                <Button
                  variant="solid"
                  onClick={handleAdd}
                  disabled={addIsDisabled}
                >
                  <FaPlus className="mr-1" /> Add
                </Button>
              </Box>
            )}
          </Flex>
          <p>
            Joins different identifier types together when needed during
            experiment analysis.
          </p>
        </>
      ) : null}
      {/* endregion Heading */}

      {/* region Identity Joins list */}
      {identityJoins.length > 0 ? (
        <Box>
          {identityJoins.map((identityJoin, idx) => {
            const isOpen = openIndexes[idx] || false;
            return (
              <Card mt="3" key={"identity-join-" + idx}>
                <Flex align="center" justify="between" py="2" px="3" gap="3">
                  {/* Title */}
                  <Heading mb="0" as="h4" size="small">
                    {identityJoin.ids.join(" ↔ ")}
                  </Heading>

                  <Box>
                    {canEdit && (
                      <>
                        <DeleteButton
                          onClick={handleActionDeleteClicked(idx)}
                          useRadix={true}
                          displayName={identityJoin.ids.join(" ↔ ")}
                          deleteMessage={`Are you sure you want to delete identifier join ${identityJoin.ids.join(
                            " ↔ ",
                          )}?`}
                          title="Delete"
                          text="Delete"
                          outline={false}
                        />
                        <Button
                          variant="ghost"
                          onClick={handleActionEditClicked(idx)}
                        >
                          Edit
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      color="violet"
                      onClick={handleExpandCollapseForIndex(idx)}
                    >
                      <FaChevronRight
                        style={{
                          transform: `rotate(${isOpen ? "90deg" : "0deg"})`,
                        }}
                      />
                    </Button>
                  </Box>
                </Flex>
                <Box>
                  {isOpen && (
                    <Box p="2">
                      <Code
                        language="sql"
                        code={identityJoin.query}
                        containerClassName="mb-0"
                        expandable
                      />
                    </Box>
                  )}
                </Box>
              </Card>
            );
          })}
        </Box>
      ) : userIdTypes.length >= 2 ? (
        <></>
      ) : null}

      {/* endregion Identity Joins list */}

      {/* region Add/Edit modal */}
      {uiMode === "edit" || uiMode === "add" ? (
        <AddEditIdentityJoinModal
          dataSource={dataSource}
          mode={uiMode}
          onSave={handleSave(editingIndex)}
          onCancel={handleCancel}
          identityJoin={identityJoins[editingIndex]}
        />
      ) : null}
      {/* endregion Add/Edit modal */}
    </Box>
  );
};
