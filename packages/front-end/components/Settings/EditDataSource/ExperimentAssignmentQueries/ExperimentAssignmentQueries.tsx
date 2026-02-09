import React, { FC, Fragment, useCallback, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { FaChevronRight, FaPlus } from "react-icons/fa";
import { Box, Card, Flex } from "@radix-ui/themes";
import { DimensionSlicesInterface } from "shared/types/dimension";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Code from "@/components/SyntaxHighlighting/Code";
import { AddEditExperimentAssignmentQueryModal } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/AddEditExperimentAssignmentQueryModal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import { UpdateDimensionMetadataModal } from "@/components/Settings/EditDataSource/DimensionMetadata/UpdateDimensionMetadata";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import { CustomDimensionMetadata } from "@/components/Settings/EditDataSource/DimensionMetadata/DimensionSlicesRunner";

type ExperimentAssignmentQueriesProps = DataSourceQueryEditingModalBaseProps;
type UIMode = "view" | "edit" | "add" | "dimension";
export const ExperimentAssignmentQueries: FC<
  ExperimentAssignmentQueriesProps
> = ({ dataSource, onSave, onCancel, canEdit = true }) => {
  const intitialOpenIndexes: boolean[] = Array.from(
    Array(dataSource.settings?.queries?.exposure?.length || 0),
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

  const experimentExposureQueries = useMemo(
    () => dataSource.settings?.queries?.exposure || [],
    [dataSource.settings?.queries?.exposure],
  );

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(experimentExposureQueries.length);
  }, [experimentExposureQueries]);

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
      copy.settings.queries.exposure.splice(idx, 1);

      await onSave(copy);
    },
    [onSave, dataSource],
  );

  const handleSave = useCallback(
    (idx: number) => async (exposureQuery: ExposureQuery) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      copy.settings.queries.exposure[idx] = exposureQuery;
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
            <Heading as="h3" size="medium" mb="0">
              Experiment Assignment Queries
            </Heading>
            <Badge
              label={experimentExposureQueries.length + ""}
              color="gray"
              radius="medium"
            />
          </Flex>
        </Box>

        {canEdit && (
          <Box>
            <Button onClick={handleAdd}>
              <FaPlus className="mr-1" /> Add
            </Button>
          </Box>
        )}
      </Flex>
      <p>
        Queries that return a list of experiment variation assignment events.
        Returns a record of which experiment variation was assigned to each
        user.
      </p>

      {/* region Empty state */}
      {experimentExposureQueries.length === 0 ? (
        <Callout status="info">
          No experiment assignment queries. Assignment queries are required for
          experiment analysis.
        </Callout>
      ) : null}
      {/* endregion Empty state */}

      {experimentExposureQueries.map((query, idx) => {
        const isOpen = openIndexes[idx] || false;

        return (
          <Card mt="3" key={query.id}>
            <Flex align="start" justify="between" py="2" px="3" gap="3">
              {/* region Title Bar */}
              <Box width="100%">
                <Flex>
                  <Heading as="h4" size="small" mb="1">
                    {query.name}
                  </Heading>
                  {query.description && (
                    <p className="ml-3 text-muted">{query.description}</p>
                  )}
                </Flex>

                <Flex gap="4">
                  <Box>
                    <strong className="font-weight-semibold">
                      Identifier:{" "}
                    </strong>
                    <code>{query.userIdType}</code>
                  </Box>
                  <Box>
                    <strong className="font-weight-semibold">
                      Dimension Columns:{" "}
                    </strong>
                    {query.dimensions.map((d, i) => (
                      <Fragment key={i}>
                        {i ? ", " : ""}
                        <code key={d}>{d}</code>
                      </Fragment>
                    ))}
                    {!query.dimensions.length && (
                      <em className="text-muted">none</em>
                    )}
                  </Box>
                </Flex>
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
                    {query.dimensions.length > 0 ? (
                      <button
                        className="dropdown-item py-2"
                        onClick={handleActionClicked(idx, "dimension")}
                      >
                        Edit Dimensions
                      </button>
                    ) : null}

                    <hr className="dropdown-divider" />
                    <DeleteButton
                      onClick={handleActionDeleteClicked(idx)}
                      className="dropdown-item text-danger py-2"
                      iconClassName="mr-2"
                      style={{ borderRadius: 0 }}
                      useIcon={false}
                      displayName={query.name}
                      deleteMessage={`Are you sure you want to delete experiment assignment query ${query.name}?`}
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
        <AddEditExperimentAssignmentQueryModal
          exposureQuery={experimentExposureQueries[editingIndex]}
          dataSource={dataSource}
          mode={uiMode}
          onSave={handleSave(editingIndex)}
          onCancel={handleCancel}
        />
      ) : null}

      {uiMode === "dimension" ? (
        <UpdateDimensionMetadataModal
          exposureQuery={experimentExposureQueries[editingIndex]}
          datasourceId={dataSource.id}
          close={() => setUiMode("view")}
          onSave={handleSaveDimensionMetadata(editingIndex, dataSource, onSave)}
        />
      ) : null}

      {/* endregion Add/Edit modal */}
    </Box>
  );
};

const handleSaveDimensionMetadata =
  (
    editingIndex: number,
    dataSource: DataSourceInterfaceWithParams,
    onSave: (dataSource: DataSourceInterfaceWithParams) => void,
  ) =>
  async (
    customDimensionMetadata: CustomDimensionMetadata[],
    dimensionSlices?: DimensionSlicesInterface,
  ) => {
    const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
    const exposureQuery = copy.settings?.queries?.exposure?.[editingIndex];

    if (!exposureQuery) {
      throw new Error(
        "Exposure queries out of sync. Refresh the page and try again.",
      );
    }

    exposureQuery.dimensionMetadata = exposureQuery.dimensions.map((d) => {
      const existingMetadata = exposureQuery.dimensionMetadata?.find(
        (m) => m.dimension === d,
      ) ?? {
        dimension: d,
        specifiedSlices: [],
      };

      const trafficSlices = dimensionSlices?.results
        .find((r) => r.dimension === d)
        ?.dimensionSlices.map((s) => s.name);

      const customDimension = customDimensionMetadata?.find(
        (m) => m.dimension === d,
      );

      // if custom slices are defined, use them, otherwise use the traffic slices.
      // If neither are defined, use fall back to the existing values.
      const specifiedSlices = customDimension?.customSlicesArray?.length
        ? customDimension.customSlicesArray
        : (trafficSlices ?? existingMetadata.specifiedSlices);

      return {
        ...existingMetadata,
        specifiedSlices,
        customSlices: !!customDimension?.customSlicesArray?.length,
      };
    });

    // re-order the dimensions array based on the priority
    exposureQuery.dimensions = exposureQuery.dimensions.sort((a, b) => {
      const aMetadata = customDimensionMetadata?.find((m) => m.dimension === a);
      const bMetadata = customDimensionMetadata?.find((m) => m.dimension === b);
      // if missing metadata, put it at the end
      if (!aMetadata) return 1;
      if (!bMetadata) return -1;
      return aMetadata.priority - bMetadata.priority;
    });

    // if dimension slices updated, update the dimension slices id
    if (dimensionSlices) {
      exposureQuery.dimensionSlicesId = dimensionSlices.id;
    }

    await onSave(copy);
  };
