import React, { FC, useCallback, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  FeatureUsageQuery,
} from "shared/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { PiDotsThreeVertical, PiPlus } from "react-icons/pi";
import { getActiveFeatureUsageQuery } from "shared/util";
import { Box, Flex, Heading, IconButton } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import Code from "@/components/SyntaxHighlighting/Code";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
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

  const handleActionDeleteClicked = useCallback(
    () => async () => {
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
    [dataSource, featureUsageQuery?.id, onSave],
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
              <Button onClick={() => setUiMode("add")} icon={<PiPlus />}>
                Add
              </Button>
            )}
            {featureUsageQuery && (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                    aria-label="Feature usage query actions"
                  >
                    <PiDotsThreeVertical size={18} />
                  </IconButton>
                }
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuItem onClick={() => setUiMode("edit")}>
                  Edit Query
                </DropdownMenuItem>

                <DropdownMenuItem
                  color="red"
                  confirmation={{
                    submit: handleActionDeleteClicked(),
                    confirmationTitle: "Delete Feature Usage Query",
                    cta: "Delete",
                    getConfirmationContent: async () =>
                      "Are you sure you want to delete this feature usage query?",
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenu>
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
