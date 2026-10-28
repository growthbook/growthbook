import { interleavingExposureQueryEndpoints } from "shared/api-endpoints";
import React, { FC, useCallback, useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ApiInterleavingExposureQueryInterface } from "shared/validators";
import { PiCaretRight, PiDotsThreeVertical, PiPlus } from "react-icons/pi";
import { Box, Card, Flex, IconButton } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Code from "@/components/SyntaxHighlighting/Code";
import AddEditInterleavingExposureQueryModal from "@/components/Interleaving/AddEditInterleavingExposureQueryModal";
import Button from "@/ui/Button";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import { useInterleavingExposureQueries } from "@/hooks/useInterleavings";
import { useRestApiCall } from "@/services/restApi";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";

type InterleavingExposureQueriesProps = {
  dataSource: DataSourceInterfaceWithParams;
  canEdit?: boolean;
};

type UIMode = "view" | "edit" | "add";

/**
 * Datasource-page section for managing Interleaving Exposure Queries. Follows
 * {@link ContextualBanditAssignmentQueries}: its own collection rather than
 * `datasource.settings.queries`, so it reads through
 * `useInterleavingExposureQueries` and writes through
 * `interleavingExposureQueryEndpoints` (create/edit in the modal, delete here).
 */
export const InterleavingExposureQueries: FC<
  InterleavingExposureQueriesProps
> = ({ dataSource, canEdit = true }) => {
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const { exposureQueries, mutate, loading } = useInterleavingExposureQueries(
    dataSource.id,
  );

  const [uiMode, setUiMode] = useState<UIMode>("view");
  const [editingQuery, setEditingQuery] = useState<
    ApiInterleavingExposureQueryInterface | undefined
  >();
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});

  const handleExpandCollapse = useCallback(
    (id: string) => () => {
      setOpenIds((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
    },
    [],
  );

  const handleAdd = useCallback(() => {
    setEditingQuery(undefined);
    setUiMode("add");
  }, []);

  const handleEdit = useCallback(
    (query: ApiInterleavingExposureQueryInterface) => () => {
      setEditingQuery(query);
      setUiMode("edit");
    },
    [],
  );

  const handleCancel = useCallback(() => {
    setUiMode("view");
    setEditingQuery(undefined);
  }, []);

  const handleSave = useCallback(async () => {
    await mutate();
    setUiMode("view");
    setEditingQuery(undefined);
  }, [mutate]);

  const handleDelete = useCallback(
    (query: ApiInterleavingExposureQueryInterface) => async () => {
      await restApiCall(
        interleavingExposureQueryEndpoints.deleteInterleavingExposureQuery,
        { params: { id: query.id } },
      );
      await mutate();
    },
    [restApiCall, mutate],
  );

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <Box>
      <Flex align="center" gap="2" mb="3" justify="between">
        <Box>
          <Flex align="center" gap="3" mb="0">
            <Heading as="h3" size="md" mb="0">
              Interleaving Exposure Queries
            </Heading>
            <Badge label="BETA" color="gray" variant="solid" />
          </Flex>
        </Box>

        <Box>
          <Button onClick={handleAdd} disabled={!canEdit} icon={<PiPlus />}>
            Add
          </Button>
        </Box>
      </Flex>
      <p>
        Queries that return interleaving impressions. Each row is one ranked
        list that was shown, with the per-item detail in a JSON array.
      </p>

      {!loading && exposureQueries.length === 0 ? (
        <Callout status="info">
          No Interleaving Exposure Queries. An interleaving experiment requires
          one of these queries to analyze results.
        </Callout>
      ) : null}

      {exposureQueries.map((query) => {
        const isOpen = openIds[query.id] ?? true;

        return (
          <Card mt="3" key={query.id}>
            <Flex align="start" justify="between" py="2" px="3" gap="3">
              <Box width="100%">
                <Heading as="h4" size="sm" mb="0">
                  {query.name}
                </Heading>
                {query.description && (
                  <p className="text-muted mb-0 mt-1">{query.description}</p>
                )}

                <Flex gap="4">
                  <Box>
                    <strong className="font-weight-semibold">
                      Identifier:{" "}
                    </strong>
                    <code>{query.userIdTypes.join(", ")}</code>
                  </Box>
                </Flex>
              </Box>

              <Flex align="center">
                {canEdit && (
                  <DropdownMenu
                    trigger={
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="full"
                        size="2"
                        highContrast
                        aria-label={`${query.name} query actions`}
                      >
                        <PiDotsThreeVertical size={18} />
                      </IconButton>
                    }
                    menuPlacement="end"
                    variant="soft"
                  >
                    <DropdownMenuItem onClick={handleEdit(query)}>
                      Edit query
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      color="red"
                      confirmation={{
                        submit: handleDelete(query),
                        confirmationTitle: `Delete ${query.name}`,
                        cta: "Delete",
                        getConfirmationContent: async () =>
                          `Are you sure you want to delete Interleaving Exposure Query ${query.name}? Any interleaving experiment using it will no longer be able to analyze results.`,
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenu>
                )}

                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                  ml="3"
                  aria-label={isOpen ? "Collapse query" : "Expand query"}
                  aria-expanded={isOpen}
                  onClick={handleExpandCollapse(query.id)}
                >
                  <PiCaretRight
                    style={{
                      transform: `rotate(${isOpen ? "90deg" : "0deg"})`,
                    }}
                  />
                </IconButton>
              </Flex>
            </Flex>

            {isOpen && (
              <Box p="2">
                <Code
                  language="sql"
                  code={query.query}
                  containerClassName="mb-0"
                />
              </Box>
            )}
          </Card>
        );
      })}

      {uiMode === "edit" || uiMode === "add" ? (
        <AddEditInterleavingExposureQueryModal
          interleavingExposureQuery={editingQuery}
          dataSource={dataSource}
          mode={uiMode}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      ) : null}
    </Box>
  );
};
