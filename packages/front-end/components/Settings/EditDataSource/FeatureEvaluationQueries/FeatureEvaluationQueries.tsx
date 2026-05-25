import React, { FC, useCallback, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  FeatureUsageQuery,
} from "shared/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { FaPlus } from "react-icons/fa";
import {
  EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS,
  getActiveFeatureUsageQuery,
  isEventForwarderManagedFeatureUsageQuery,
} from "shared/util";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Code from "@/components/SyntaxHighlighting/Code";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { FeatureEvaluationQueryModal } from "./FeatureEvaluationQueryModal";

type FeatureEvaluationQueriesProps = Omit<
  DataSourceQueryEditingModalBaseProps,
  "onCancel"
>;
type UIMode = "view" | "edit" | "add" | "dimension";
type SyncState = "idle" | "syncing" | "done" | "error";

export const FeatureEvaluationQueries: FC<FeatureEvaluationQueriesProps> = ({
  dataSource,
  onSave,
  canEdit = true,
}) => {
  const [uiMode, setUiMode] = useState<UIMode>("view");

  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);
  const { apiCall } = useAuth();

  const featureUsageQuery = useMemo(
    () =>
      getActiveFeatureUsageQuery(dataSource.settings?.queries?.featureUsage),
    [dataSource.settings?.queries?.featureUsage],
  );

  const isManagedQuery = useMemo(
    () =>
      featureUsageQuery
        ? isEventForwarderManagedFeatureUsageQuery(featureUsageQuery)
        : false,
    [featureUsageQuery],
  );

  const showSyncWarehouseSchemaButton =
    canEdit &&
    dataSource.eventForwarderConfig?.status === "ready" &&
    isManagedQuery;

  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleActionDeleteClicked = useCallback(
    () => async () => {
      if (isManagedQuery) {
        return;
      }

      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      const existing = copy.settings.queries?.featureUsage ?? [];
      const next = existing.filter(
        (query) => query.id !== featureUsageQuery?.id,
      );

      if (!copy.settings.queries) {
        copy.settings.queries = { featureUsage: next };
      } else {
        copy.settings.queries.featureUsage = next;
      }

      await onSave(copy);
    },
    [dataSource, featureUsageQuery?.id, isManagedQuery, onSave],
  );

  const handleSave = useCallback(
    () => async (savedQuery: FeatureUsageQuery) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      const existing = copy.settings.queries?.featureUsage ?? [];
      const index = existing.findIndex((query) => query.id === savedQuery.id);

      if (!copy.settings.queries) {
        copy.settings.queries = { featureUsage: [savedQuery] };
      } else if (index >= 0) {
        copy.settings.queries.featureUsage = existing.map((query, idx) =>
          idx === index ? savedQuery : query,
        );
      } else {
        copy.settings.queries.featureUsage = [...existing, savedQuery];
      }

      await onSave(copy);
    },
    [dataSource, onSave],
  );

  const handleSyncWarehouseSchema = useCallback(async () => {
    setSyncState("syncing");
    setSyncError(null);
    try {
      await apiCall(
        `/datasource/${dataSource.id}/event-forwarder/schematization-sync`,
        { method: "POST" },
      );
      await new Promise((resolve) =>
        setTimeout(resolve, EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS),
      );
      await onSave(cloneDeep<DataSourceInterfaceWithParams>(dataSource));
      setSyncState("done");
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
      setSyncState("error");
    } finally {
      window.setTimeout(() => setSyncState("idle"), 3000);
    }
  }, [apiCall, dataSource, onSave]);

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <Box>
      <Flex align="center" gap="2" mb="3" justify="between">
        <Box>
          <Flex align="center" gap="3" mb="0">
            <Heading as="h3" size="4" mb="0">
              Feature Usage Query
            </Heading>
          </Flex>
        </Box>

        {canEdit && (
          <Flex gap="2">
            {showSyncWarehouseSchemaButton ? (
              <Tooltip body="Pushes the latest Event Forwarder schema to your warehouse and re-validates the feature usage query.">
                <Button
                  variant="outline"
                  loading={syncState === "syncing"}
                  onClick={handleSyncWarehouseSchema}
                >
                  Sync warehouse schema
                </Button>
              </Tooltip>
            ) : null}
            {!featureUsageQuery && (
              <Button onClick={() => setUiMode("add")}>
                <FaPlus className="mr-1" /> Add
              </Button>
            )}
            {featureUsageQuery && !isManagedQuery && (
              <MoreMenu>
                <button
                  className="dropdown-item py-2"
                  onClick={() => setUiMode("edit")}
                >
                  Edit Query
                </button>

                <hr className="dropdown-divider" />
                <DeleteButton
                  onClick={handleActionDeleteClicked()}
                  className="dropdown-item text-danger py-2"
                  iconClassName="mr-2"
                  style={{ borderRadius: 0 }}
                  useIcon={false}
                  displayName={"Feature Usage Query"}
                  deleteMessage={`Are you sure you want to delete this feature usage query?`}
                  title="Delete"
                  text="Delete"
                  outline={false}
                />
              </MoreMenu>
            )}
          </Flex>
        )}
      </Flex>
      <p>
        Returns a list of feature evaluation events for feature evaluation
        diagnostics.
      </p>

      {syncState === "done" ? (
        <Callout status="success" mt="3">
          Warehouse schema sync completed. Feature usage query was re-validated.
        </Callout>
      ) : null}
      {syncState === "error" && syncError ? (
        <Callout status="error" mt="3">
          {syncError}
        </Callout>
      ) : null}

      {!featureUsageQuery ? (
        <Callout status="info">
          A feature usage query has not been added. Feature usage queries are
          required for feature evaluation diagnostics.
        </Callout>
      ) : null}

      {featureUsageQuery && (
        <Box p="2">
          {featureUsageQuery.error ? (
            <Callout status="error" mb="3">
              {featureUsageQuery.error}
            </Callout>
          ) : null}
          <Code
            language="sql"
            code={featureUsageQuery.query}
            containerClassName="mb-0"
            expandable
          />
        </Box>
      )}

      {uiMode === "edit" || uiMode === "add" ? (
        <FeatureEvaluationQueryModal
          featureUsageQuery={featureUsageQuery}
          dataSource={dataSource}
          mode={uiMode}
          onSave={handleSave()}
          onCancel={() => setUiMode("view")}
        />
      ) : null}
    </Box>
  );
};
