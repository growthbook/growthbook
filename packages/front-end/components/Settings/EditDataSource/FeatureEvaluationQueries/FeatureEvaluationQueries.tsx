import React, { FC, useCallback, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  FeatureUsageQuery,
} from "shared/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { FaPlus } from "react-icons/fa";
import {
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
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { FeatureEvaluationQueryModal } from "./FeatureEvaluationQueryModal";

type FeatureEvaluationQueriesProps = Omit<
  DataSourceQueryEditingModalBaseProps,
  "onCancel"
>;
type UIMode = "view" | "edit" | "add" | "dimension";

export const FeatureEvaluationQueries: FC<FeatureEvaluationQueriesProps> = ({
  dataSource,
  onSave,
  canEdit = true,
}) => {
  const [uiMode, setUiMode] = useState<UIMode>("view");
  const [validatingQuery, setValidatingQuery] = useState(false);

  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

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

  const handleValidate = useCallback(
    () => async () => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      setValidatingQuery(true);
      await onSave(copy);
      setValidatingQuery(false);
    },
    [dataSource, onSave],
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
            <Heading as="h3" size="4" mb="0">
              Feature Usage Query
            </Heading>
          </Flex>
        </Box>

        {canEdit && (
          <Flex gap="2">
            {!featureUsageQuery && (
              <Button onClick={() => setUiMode("add")}>
                <FaPlus className="mr-1" /> Add
              </Button>
            )}
            {featureUsageQuery && !isManagedQuery && (
              <MoreMenu useRadix={false}>
                <button
                  className="dropdown-item py-2"
                  onClick={() => setUiMode("edit")}
                >
                  Edit Query
                </button>

                <hr className="dropdown-divider" />
                <DeleteButton
                  useRadix={false}
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
              This query had an error with it the last time it ran:{" "}
              <Box className="font-weight-bold" py="2">
                {featureUsageQuery.error}
              </Box>
              <Box mt="3">
                <Button
                  color="inherit"
                  onClick={handleValidate()}
                  loading={validatingQuery}
                >
                  Check it again.
                </Button>
              </Box>
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
