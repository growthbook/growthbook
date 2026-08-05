import React, { FC, Fragment, useCallback, useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ApiContextualBanditQueryInterface } from "shared/validators";
import { PiCaretRight, PiDotsThreeVertical, PiPlus } from "react-icons/pi";
import { Box, Card, Flex, IconButton } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Code from "@/components/SyntaxHighlighting/Code";
import AddEditContextualBanditQueryModal from "@/components/ContextualBandit/AddEditContextualBanditQueryModal";
import Button from "@/ui/Button";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import { useAuth } from "@/services/auth";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";

type ContextualBanditAssignmentQueriesProps = {
  dataSource: DataSourceInterfaceWithParams;
  canEdit?: boolean;
};

type UIMode = "view" | "edit" | "add";

/**
 * Datasource-page section for managing Contextual Bandit Assignment Queries — the
 * CB-specific mirror of {@link ExperimentAssignmentQueries}. Unlike EAQ (which is
 * embedded in `datasource.settings.queries.exposure[]` and saved via a whole-datasource
 * PUT), CB queries live in their own collection, so this section reads via
 * `useContextualBanditQueries` and writes via the `/api/v1/contextual-bandit-queries`
 * CRUD endpoints (create/edit handled inside the modal; delete handled here).
 */
export const ContextualBanditAssignmentQueries: FC<
  ContextualBanditAssignmentQueriesProps
> = ({ dataSource, canEdit = true }) => {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const { contextualBanditQueries, mutate, loading } =
    useContextualBanditQueries(dataSource.id);

  const [uiMode, setUiMode] = useState<UIMode>("view");
  const [editingQuery, setEditingQuery] = useState<
    ApiContextualBanditQueryInterface | undefined
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
    (query: ApiContextualBanditQueryInterface) => () => {
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
    (query: ApiContextualBanditQueryInterface) => async () => {
      await apiCall(`/api/v1/contextual-bandit-queries/${query.id}`, {
        method: "DELETE",
      });
      await mutate();
    },
    [apiCall, mutate],
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
              Contextual Bandit Assignment Queries
            </Heading>
            <Badge label="BETA" color="gray" variant="solid" />
            <Badge
              label={contextualBanditQueries.length + ""}
              color="gray"
              radius="medium"
            />
          </Flex>
        </Box>

        <Box>
          <Button onClick={handleAdd} disabled={!canEdit} icon={<PiPlus />}>
            Add
          </Button>
        </Box>
      </Flex>
      <p>
        Queries that return contextual bandit assignment events. Returns a
        record of which contextual bandit variation was assigned to each user.
      </p>

      {!loading && contextualBanditQueries.length === 0 ? (
        <Callout status="info">
          No contextual bandit assignment queries. A contextual bandit requires
          one of these queries to analyze results.
        </Callout>
      ) : null}

      {contextualBanditQueries.map((query) => {
        const isOpen = openIds[query.id] ?? true;
        const targetingColumns = query.targetingAttributeColumns ?? [];

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
                    <code>{query.userIdType}</code>
                  </Box>
                  <Box>
                    <strong className="font-weight-semibold">
                      Targeting Attributes:{" "}
                    </strong>
                    {targetingColumns.map((d, i) => (
                      <Fragment key={d}>
                        {i ? ", " : ""}
                        <code>{d}</code>
                      </Fragment>
                    ))}
                    {!targetingColumns.length && (
                      <em className="text-muted">none</em>
                    )}
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
                      Edit Query
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      color="red"
                      confirmation={{
                        submit: handleDelete(query),
                        confirmationTitle: `Delete ${query.name}`,
                        cta: "Delete",
                        getConfirmationContent: async () =>
                          `Are you sure you want to delete contextual bandit assignment query ${query.name}? Any contextual bandit using it will no longer be able to analyze results.`,
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
        <AddEditContextualBanditQueryModal
          contextualBanditQuery={editingQuery}
          dataSource={dataSource}
          mode={uiMode}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      ) : null}
    </Box>
  );
};
