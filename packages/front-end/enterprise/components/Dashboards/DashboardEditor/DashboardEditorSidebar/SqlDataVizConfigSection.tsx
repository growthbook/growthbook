import { useEffect, useMemo, useState } from "react";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DataVisualizationBlockInterface,
} from "shared/enterprise";
import { SavedQuery } from "shared/validators";
import {
  PiCopySimple,
  PiPencilSimpleFill,
  PiTrashSimpleFill,
} from "react-icons/pi";
import Code from "@/components/SyntaxHighlighting/Code";
import RadioGroup from "@/ui/RadioGroup";
import Button from "@/ui/Button";
import useApi from "@/hooks/useApi";
import SelectField from "@/components/Forms/SelectField";
import SqlExplorerModal, {
  SqlExplorerModalInitial,
} from "@/components/SchemaBrowser/SqlExplorerModal";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";

interface Props {
  block: DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>
  >;
  dashboardId: string;
  projects: string[];
  savedQuery: SavedQuery | undefined;
  mutateQueries: () => void;
}

export default function SqlDataVizConfigSection({
  block,
  setBlock,
  dashboardId,
  projects,
  savedQuery,
  mutateQueries,
}: Props) {
  const [sqlExplorerType, setSqlExplorerType] = useState<"create" | "existing">(
    "existing",
  );
  const [sqlExplorerModalProps, setSqlExplorerModalProps] = useState<
    { initial?: SqlExplorerModalInitial; savedQueryId?: string } | undefined
  >(undefined);
  const [
    showDeleteSavedQueryConfirmation,
    setShowDeleteSavedQueryConfirmation,
  ] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { apiCall } = useAuth();
  const { data: savedQueriesData } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>(`/saved-queries/`);

  const savedQueryId =
    block.dataSourceConfig?.dataType === "sql"
      ? block.dataSourceConfig.savedQueryId
      : undefined;

  const savedQueryOptions = useMemo(
    () =>
      savedQueriesData?.savedQueries
        ?.filter((savedQuery) => {
          return (
            savedQuery.linkedDashboardIds?.includes(dashboardId) ||
            savedQueryId === savedQuery.id
          );
        })
        .map(({ id, name }) => ({
          value: id,
          label: name,
        })) || [],
    [savedQueriesData?.savedQueries, dashboardId, savedQueryId],
  );

  useEffect(() => {
    if (
      sqlExplorerType === "existing" &&
      !savedQueryOptions.length &&
      !savedQueryId
    ) {
      setSqlExplorerType("create");
    }
  }, [block?.type, savedQueryId, savedQueryOptions.length, sqlExplorerType]);

  return (
    <>
      {savedQuery && showDeleteSavedQueryConfirmation && (
        <Modal
          trackingEventModalType=""
          header={"Delete Saved Query?"}
          close={() => setShowDeleteSavedQueryConfirmation(false)}
          open={true}
          cta="Delete"
          submitColor="danger"
          submit={async () => {
            await apiCall(`/saved-queries/${savedQuery.id}`, {
              method: "DELETE",
            });
            if (block.dataSourceConfig?.dataType === "sql") {
              setBlock({
                ...block,
                dataSourceConfig: { dataType: "sql", savedQueryId: "" },
              });
            }
            mutateQueries();
          }}
          increasedElevation={true}
        >
          Are you sure? This action cannot be undone.
        </Modal>
      )}
      {sqlExplorerModalProps && (
        <SqlExplorerModal
          dashboardId={dashboardId}
          close={() => {
            setSqlExplorerModalProps(undefined);
          }}
          mutate={mutateQueries}
          projects={projects}
          canAddVisualizations={false}
          initial={sqlExplorerModalProps.initial}
          id={sqlExplorerModalProps.savedQueryId}
          onSave={async ({ savedQueryId: newSavedQueryId, name }) => {
            if (!newSavedQueryId) return;

            setBlock({
              ...block,
              title: name || block.title,
              dataSourceConfig: {
                dataType: "sql",
                savedQueryId: newSavedQueryId,
              },
            });

            setSqlExplorerType("existing");
            mutateQueries();
          }}
        />
      )}
      <Flex direction="column" gap="3">
        <RadioGroup
          value={sqlExplorerType}
          setValue={(value: "create" | "existing") => {
            // Reset the saved query id if the type changes
            setBlock({
              ...block,
              dataSourceConfig: {
                dataType: "sql",
                savedQueryId: "",
              },
            });
            setSqlExplorerType(value);
          }}
          options={[
            {
              label: "Select existing query",
              value: "existing",
              disabled: !savedQueryOptions.length,
            },
            {
              label: "Create new query",
              value: "create",
            },
          ]}
        />
        {sqlExplorerType === "create" ? (
          <Button variant="soft" onClick={() => setSqlExplorerModalProps({})}>
            <span className="w-100">
              <PiPencilSimpleFill /> Create query
            </span>
          </Button>
        ) : (
          <>
            <SelectField
              required
              labelClassName="flex-grow-1"
              containerClassName="mb-0"
              value={savedQueryId || ""}
              forceUndefinedValueToNull
              placeholder="Choose a saved query"
              label={
                <Flex justify="between" align="center">
                  <Text weight="bold">Saved Query</Text>
                  <Flex align="center" gap="1">
                    <IconButton
                      disabled={!savedQueryId}
                      variant="soft"
                      size="1"
                      onClick={() => setShowDeleteSavedQueryConfirmation(true)}
                    >
                      <PiTrashSimpleFill />
                    </IconButton>
                    <IconButton
                      disabled={!savedQueryId}
                      variant="soft"
                      size="1"
                      onClick={() =>
                        setSqlExplorerModalProps({
                          initial: savedQuery,
                        })
                      }
                    >
                      <PiCopySimple />
                    </IconButton>
                    <IconButton
                      disabled={!savedQueryId}
                      variant="soft"
                      size="1"
                      onClick={() =>
                        setSqlExplorerModalProps({
                          initial: savedQuery,
                          savedQueryId: savedQueryId || "",
                        })
                      }
                    >
                      <PiPencilSimpleFill />
                    </IconButton>
                  </Flex>
                </Flex>
              }
              options={savedQueryOptions}
              onChange={(val) => {
                setBlock({
                  ...block,
                  title:
                    savedQueryOptions.find((option) => option.value === val)
                      ?.label || "SQL Query",
                  dataSourceConfig: {
                    dataType: "sql",
                    savedQueryId: val,
                  },
                });
              }}
              isClearable
            />
          </>
        )}
        {savedQuery && (
          <>
            <Code language="sql" code={savedQuery.sql} />
            <Button
              variant="soft"
              onClick={async () => {
                setRefreshError(null);
                setIsRefreshing(true);
                try {
                  await apiCall(`/saved-queries/${savedQueryId}/refresh`, {
                    method: "POST",
                  });
                  mutateQueries();
                } catch (e) {
                  console.error("Error refreshing query:", e);
                  setRefreshError(e.message);
                } finally {
                  setIsRefreshing(false);
                }
              }}
              disabled={isRefreshing}
              loading={isRefreshing}
            >
              Refresh Data
            </Button>
            {refreshError && (
              <Text color="red" size="2">
                Error refreshing data: {refreshError}
              </Text>
            )}
          </>
        )}
      </Flex>
    </>
  );
}
