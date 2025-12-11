import React, { FC, useCallback, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  FeatureUsageQuery,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { FaChevronRight, FaPlus } from "react-icons/fa";
import { Box, Card, Flex, Heading } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Code from "@/components/SyntaxHighlighting/Code";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Button from "@/ui/Button";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import { FeatureEvaluationQueryModal } from "./FeatureEvaluationQueryModal";

type FeatureEvaluationQueriesProps = DataSourceQueryEditingModalBaseProps;
type UIMode = "view" | "edit" | "add" | "dimension";
export const FeatureEvaluationQueries: FC<FeatureEvaluationQueriesProps> = ({
  dataSource,
  onSave,
  onCancel,
  canEdit = true,
}) => {
  const intitialOpenIndexes: boolean[] = Array.from(
    Array(dataSource.settings?.queries?.featureUsage?.length || 0),
  ).fill(true);

  const [uiMode, setUiMode] = useState<UIMode>("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [openIndexes, setOpenIndexes] =
    useState<boolean[]>(intitialOpenIndexes);

  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const handleExpandCollapseForIndex = useCallback(
    (index) => () => {
      const currentValue = openIndexes[index] || false;
      const updatedOpenIndexes = [...openIndexes];
      updatedOpenIndexes[index] = !currentValue;

      setOpenIndexes(updatedOpenIndexes);
    },
    [openIndexes],
  );

  const handleCancel = useCallback(() => {
    setUiMode("view");
    setEditingIndex(-1);
    onCancel();
  }, [onCancel]);

  const featureUsageQueries = useMemo(
    () => dataSource.settings?.queries?.featureUsage || [],
    [dataSource.settings?.queries?.featureUsage],
  );

  console.log("featureUsageQueries", featureUsageQueries);

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(featureUsageQueries.length);
  }, [featureUsageQueries]);

  const handleActionClicked = useCallback(
    (idx: number, uiMode: UIMode) => async () => {
      setEditingIndex(idx);
      setUiMode(uiMode);
    },
    [],
  );

  const handleActionDeleteClicked = useCallback(
    (idx: number) => async () => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);

      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      copy.settings.queries.featureUsage.splice(idx, 1);

      await onSave(copy);
    },
    [onSave, dataSource],
  );

  const handleSave = useCallback(
    (idx: number) => async (featureUsageQuery: FeatureUsageQuery) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      if (!copy.settings.queries.featureUsage) {
        // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
        copy.settings.queries.featureUsage = [];
      }
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      copy.settings.queries.featureUsage[idx] = featureUsageQuery;
      await onSave(copy);
    },
    [dataSource, onSave],
  );

  const [validatingQuery, setValidatingQuery] = useState(false);

  const handleValidate = useCallback(
    () => async () => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      setValidatingQuery(true);
      // Resaving the document as-is will automatically revalidate any queries in error state
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

        {canEdit && featureUsageQueries.length === 0 && (
          <Box>
            <Button onClick={handleAdd}>
              <FaPlus className="mr-1" /> Add
            </Button>
          </Box>
        )}
      </Flex>
      <p>
        Return a list of feature evaluation events for feature evaluation
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

      {featureUsageQueries.map((query, idx) => {
        const isOpen = openIndexes[idx] || false;

        return (
          <Card mt="3" key={query.id}>
            <Flex align="start" justify="between" py="2" px="3" gap="3">
              {/* region Title Bar */}
              <Box width="100%">
                <Flex>
                  <Heading as="h4" size="3" mb="1">
                    {query.name}
                  </Heading>
                  {query.description && (
                    <p className="ml-3 text-muted">{query.description}</p>
                  )}
                </Flex>

                <Flex gap="4"></Flex>
                {query.error && (
                  <Callout status="error" mt="3">
                    <Box>
                      This query had an error with it the last time it ran:{" "}
                      <Box className="font-weight-bold" py="2">
                        {query.error}
                      </Box>
                      <Box mt="3">
                        <Button
                          onClick={handleValidate()}
                          loading={validatingQuery}
                        >
                          Check it again.
                        </Button>
                        {canEdit && (
                          <Button
                            onClick={handleActionClicked(idx, "edit")}
                            style={{ marginLeft: "1rem" }}
                          >
                            Edit it now.
                          </Button>
                        )}
                      </Box>
                    </Box>
                  </Callout>
                )}
              </Box>

              {/* endregion Title Bar */}

              {/* region Actions*/}

              <Flex align="center">
                {canEdit && (
                  <MoreMenu>
                    <button
                      className="dropdown-item py-2"
                      onClick={handleActionClicked(idx, "edit")}
                    >
                      Edit Query
                    </button>

                    <hr className="dropdown-divider" />
                    <DeleteButton
                      onClick={handleActionDeleteClicked(idx)}
                      className="dropdown-item text-danger py-2"
                      iconClassName="mr-2"
                      style={{ borderRadius: 0 }}
                      useIcon={false}
                      displayName={query.name}
                      deleteMessage={`Are you sure you want to delete feature usage query ${query.name}?`}
                      title="Delete"
                      text="Delete"
                      outline={false}
                    />
                  </MoreMenu>
                )}

                <button
                  className="btn ml-3 text-dark"
                  onClick={handleExpandCollapseForIndex(idx)}
                >
                  <FaChevronRight
                    style={{
                      transform: `rotate(${isOpen ? "90deg" : "0deg"})`,
                    }}
                  />
                </button>
              </Flex>

              {/* endregion Actions*/}
            </Flex>

            {isOpen && (
              <Box p="2">
                <Code
                  language="sql"
                  code={query.query}
                  containerClassName="mb-0"
                  expandable
                />
              </Box>
            )}
          </Card>
        );
      })}

      {/* region Add/Edit modal */}

      {uiMode === "edit" || uiMode === "add" ? (
        <FeatureEvaluationQueryModal
          featureUsageQuery={featureUsageQueries[editingIndex]}
          dataSource={dataSource}
          mode={uiMode}
          onSave={handleSave(editingIndex)}
          onCancel={handleCancel}
        />
      ) : null}

      {/* endregion Add/Edit modal */}
    </Box>
  );
};
