import React, { FC, useCallback, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  FeatureUsageQuery,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { FaPlus } from "react-icons/fa";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Code from "@/components/SyntaxHighlighting/Code";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { FeatureEvaluationQueryModal } from "./FeatureEvaluationQueryModal";

type FeatureEvaluationQueriesProps = DataSourceQueryEditingModalBaseProps;
type UIMode = "view" | "edit" | "add" | "dimension";
export const FeatureEvaluationQueries: FC<FeatureEvaluationQueriesProps> = ({
  dataSource,
  onSave,
  canEdit = true,
}) => {
  const [uiMode, setUiMode] = useState<UIMode>("view");

  const featureUsageQueries = useMemo(
    () => dataSource.settings?.queries?.featureUsage || [],
    [dataSource.settings?.queries?.featureUsage],
  );

  const handleActionDeleteClicked = useCallback(
    () => async () => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);

      if (!copy.settings.queries) {
        copy.settings.queries = { featureUsage: [] };
      } else {
        copy.settings.queries.featureUsage = [];
      }

      await onSave(copy);
    },
    [onSave, dataSource],
  );

  const handleSave = useCallback(
    () => async (featureUsageQuery: FeatureUsageQuery) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);

      if (!copy.settings.queries) {
        copy.settings.queries = { featureUsage: [featureUsageQuery] };
      } else {
        copy.settings.queries.featureUsage = [featureUsageQuery];
      }
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
      <Flex align="center" gap="2" mb="3" justify="between">
        <Box>
          <Flex align="center" gap="3" mb="0">
            <Heading as="h3" size="4" mb="0">
              Feature Usage Query
            </Heading>
          </Flex>
        </Box>

        {canEdit && featureUsageQueries.length === 0 && (
          <Box>
            <Button onClick={() => setUiMode("add")}>
              <FaPlus className="mr-1" /> Add
            </Button>
          </Box>
        )}
        {canEdit && featureUsageQueries.length > 0 && (
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
      <p>
        Returns a list of feature evaluation events for feature evaluation
        diagnostics.
      </p>

      {/* region Empty state */}
      {featureUsageQueries.length === 0 ? (
        <Callout status="info">
          A feature usage query has not been added. Feature usage queries are
          required for feature evaluation diagnostics.
        </Callout>
      ) : null}
      {/* endregion Empty state */}

      {featureUsageQueries.length > 0 && (
        <Box p="2">
          <Code
            language="sql"
            code={featureUsageQueries[0].query}
            containerClassName="mb-0"
            expandable
          />
        </Box>
      )}

      {/* region Add/Edit modal */}

      {uiMode === "edit" || uiMode === "add" ? (
        <FeatureEvaluationQueryModal
          featureUsageQuery={featureUsageQueries[0]}
          dataSource={dataSource}
          mode={uiMode}
          onSave={handleSave()}
          onCancel={() => setUiMode("view")}
        />
      ) : null}

      {/* endregion Add/Edit modal */}
    </Box>
  );
};
