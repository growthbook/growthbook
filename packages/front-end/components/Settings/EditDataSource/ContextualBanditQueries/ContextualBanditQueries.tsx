import { FC, useCallback, useMemo, useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ContextualBanditQueryInterface } from "shared/validators";
import { Box, Card, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import { FaChevronRight, FaPlus } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Code from "@/components/SyntaxHighlighting/Code";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Badge from "@/ui/Badge";
import { ContextualBanditQueryModal } from "./ContextualBanditQueryModal";

type UIMode = "view" | "edit" | "add";

type Props = {
  dataSource: DataSourceInterfaceWithParams;
  canEdit?: boolean;
};

export const ContextualBanditQueries: FC<Props> = ({
  dataSource,
  canEdit = true,
}) => {
  const { mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();
  const { data, mutate } = useApi<{
    cbaqs: ContextualBanditQueryInterface[];
  }>(`/contextual-bandit-queries?datasource=${dataSource.id}`);

  const cbaqs = useMemo(() => data?.cbaqs || [], [data?.cbaqs]);

  const [uiMode, setUiMode] = useState<UIMode>("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [openIndexes, setOpenIndexes] = useState<boolean[]>(() =>
    Array(cbaqs.length).fill(true),
  );

  const handleExpandCollapse = useCallback(
    (index: number) => () => {
      setOpenIndexes((prev) => {
        const next = [...prev];
        next[index] = !next[index];
        return next;
      });
    },
    [],
  );

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(cbaqs.length);
  }, [cbaqs.length]);

  const handleEdit = useCallback(
    (index: number) => () => {
      setEditingIndex(index);
      setUiMode("edit");
    },
    [],
  );

  const handleClose = useCallback(() => {
    setUiMode("view");
    setEditingIndex(-1);
  }, []);

  const handleSaved = useCallback(async () => {
    await mutate();
    await mutateDefinitions({});
    handleClose();
  }, [mutate, mutateDefinitions, handleClose]);

  const handleDelete = useCallback(
    (id: string) => async () => {
      await apiCall(`/contextual-bandit-queries/${id}`, { method: "DELETE" });
      await mutate();
      await mutateDefinitions({});
    },
    [apiCall, mutate, mutateDefinitions],
  );

  return (
    <Box>
      <Flex align="center" gap="2" mb="3" justify="between">
        <Flex align="center" gap="3">
          <Heading as="h3" size="4" mb="0">
            Contextual Bandit Queries
          </Heading>
          <Badge label={String(cbaqs.length)} color="gray" radius="medium" />
        </Flex>
        {canEdit && (
          <Button onClick={handleAdd}>
            <FaPlus className="mr-1" /> Add
          </Button>
        )}
      </Flex>
      <p>
        Queries that return user assignment rows and contextual attributes used
        by contextual bandit experiments.
      </p>

      {cbaqs.length === 0 ? (
        <Callout status="info">
          No contextual bandit queries have been added for this datasource.
        </Callout>
      ) : null}

      {cbaqs.map((cbaq, idx) => {
        const isOpen = openIndexes[idx] ?? true;
        return (
          <Card mt="3" key={cbaq.id}>
            <Flex align="start" justify="between" py="2" px="3" gap="3">
              <Box width="100%">
                <Heading as="h4" size="3" mb="1">
                  {cbaq.name}
                </Heading>
                <Flex gap="4">
                  <Box>
                    <strong className="font-weight-semibold">
                      Identifier:{" "}
                    </strong>
                    <code>{cbaq.userIdType}</code>
                  </Box>
                  <Box>
                    <strong className="font-weight-semibold">
                      Attributes:{" "}
                    </strong>
                    {cbaq.attributes.map((a, i) => (
                      <span key={a.attribute}>
                        {i > 0 && ", "}
                        <code>{a.attribute}</code>
                      </span>
                    ))}
                  </Box>
                </Flex>
              </Box>

              <Flex align="center">
                {canEdit && (
                  <MoreMenu>
                    <button
                      className="dropdown-item py-2"
                      onClick={handleEdit(idx)}
                    >
                      Edit Query
                    </button>
                    <hr className="dropdown-divider" />
                    <DeleteButton
                      onClick={handleDelete(cbaq.id)}
                      className="dropdown-item text-danger py-2"
                      iconClassName="mr-2"
                      style={{ borderRadius: 0 }}
                      useIcon={false}
                      displayName={cbaq.name}
                      deleteMessage={`Are you sure you want to delete contextual bandit query "${cbaq.name}"?`}
                      title="Delete"
                      text="Delete"
                      outline={false}
                    />
                  </MoreMenu>
                )}
                <button
                  className="btn ml-3 text-dark"
                  onClick={handleExpandCollapse(idx)}
                >
                  <FaChevronRight
                    style={{
                      transform: `rotate(${isOpen ? "90deg" : "0deg"})`,
                    }}
                  />
                </button>
              </Flex>
            </Flex>

            {isOpen && (
              <Box p="2">
                <Code
                  language="sql"
                  code={cbaq.query}
                  containerClassName="mb-0"
                  expandable
                />
              </Box>
            )}
          </Card>
        );
      })}

      {(uiMode === "add" || uiMode === "edit") && (
        <ContextualBanditQueryModal
          dataSource={dataSource}
          initialData={uiMode === "edit" ? cbaqs[editingIndex] : undefined}
          close={handleClose}
          onSave={handleSaved}
        />
      )}
    </Box>
  );
};
