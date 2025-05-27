import { Flex, Card, Box, Heading } from "@radix-ui/themes";
import {
  GrowthbookClickhouseDataSourceWithParams,
  MaterializedColumn,
} from "back-end/types/datasource";
import { useMemo, useState } from "react";
import { FaPlus } from "react-icons/fa";
import { cloneDeep } from "lodash";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Badge from "@/components/Radix/Badge";
import Button from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";
import { DataSourceQueryEditingModalBaseProps } from "../types";
import AddEditMaterializedColumnsModal from "./AddEditMaterializedColumnsModal";

type ClickhouseMaterializedColumnsProps = Omit<
  DataSourceQueryEditingModalBaseProps,
  "dataSource"
> & {
  dataSource: GrowthbookClickhouseDataSourceWithParams;
};

export default function ClickhouseMaterializedColumns({
  dataSource,
  onSave,
  canEdit,
}: ClickhouseMaterializedColumnsProps) {
  const materializedColumns = useMemo(
    () => dataSource.settings.materializedColumns || [],
    [dataSource.settings.materializedColumns]
  );
  const [addModal, setAddModal] = useState(false);
  const [editColumnIdx, setEditColumnIdx] = useState<number | undefined>(
    undefined
  );

  const deleteColumn = async (idx: number) => {
    const copy = cloneDeep(dataSource);
    copy.settings.materializedColumns = (
      copy.settings.materializedColumns || []
    ).filter((_col, i) => i !== idx);
    await onSave(copy);
  };

  const saveColumn = async (column: MaterializedColumn, idx?: number) => {
    const copy = cloneDeep(dataSource);
    copy.settings.materializedColumns ||= [];
    if (typeof idx !== "undefined") {
      copy.settings.materializedColumns[idx] = column;
    } else {
      copy.settings.materializedColumns.push(column);
    }
    await onSave(copy);
  };

  return (
    <>
      {addModal && (
        <AddEditMaterializedColumnsModal
          mode="add"
          column={undefined}
          existingColumnNames={materializedColumns.map((c) => c.columnName)}
          existingSourceFields={materializedColumns.map((c) => c.sourceField)}
          onSave={saveColumn}
          onCancel={() => {
            setAddModal(false);
          }}
        />
      )}
      {typeof editColumnIdx !== "undefined" && (
        <AddEditMaterializedColumnsModal
          mode="edit"
          column={materializedColumns[editColumnIdx]}
          existingColumnNames={materializedColumns.map((c, idx) =>
            idx === editColumnIdx ? "" : c.columnName
          )}
          existingSourceFields={materializedColumns.map((c, idx) =>
            idx === editColumnIdx ? "" : c.sourceField
          )}
          onSave={(column) => saveColumn(column, editColumnIdx)}
          onCancel={() => {
            setEditColumnIdx(undefined);
          }}
        />
      )}
      <Box>
        <Flex align="center" gap="2" mb="3" justify="between">
          <Box>
            <Flex align="center" gap="3" mb="0">
              <Heading as="h3" size="4" mb="0">
                Materialized Columns
              </Heading>
              <Badge
                label={materializedColumns.length + ""}
                color="gray"
                radius="medium"
              />
            </Flex>
          </Box>

          {canEdit && (
            <Box>
              <Button onClick={() => setAddModal(true)}>
                <FaPlus className="mr-1" /> Add
              </Button>
            </Box>
          )}
        </Flex>
        <p>
          Fields in the event payload to be materialized as separate columns to
          improve ease of use. This also improves query performance for fields
          frequently used for filters or aggregation
        </p>

        {materializedColumns.length === 0 ? (
          <Callout status="info">No materialized columns</Callout>
        ) : null}

        {materializedColumns.map((colInfo, idx) => {
          return (
            <Card mt="3" key={colInfo.columnName}>
              <Flex align="start" justify="between" py="2" px="3" gap="3">
                <Box width="100%">
                  <Flex>
                    <Heading as="h4" size="3" mb="1">
                      {colInfo.columnName}
                    </Heading>
                    {colInfo.sourceField !== colInfo.columnName && (
                      <p className="ml-3 text-muted">{colInfo.sourceField}</p>
                    )}
                  </Flex>

                  <Flex gap="4">
                    <Box>
                      <strong className="font-weight-semibold">
                        Datatype:{" "}
                      </strong>
                      <code>{colInfo.datatype}</code>
                    </Box>
                  </Flex>
                </Box>

                {canEdit && (
                  <MoreMenu>
                    <button
                      className="dropdown-item py-2"
                      onClick={() => setEditColumnIdx(idx)}
                    >
                      Edit Materialized Column
                    </button>
                    <DeleteButton
                      onClick={() => deleteColumn(idx)}
                      className="dropdown-item text-danger py-2"
                      iconClassName="mr-2"
                      style={{ borderRadius: 0 }}
                      useIcon={false}
                      displayName={colInfo.columnName}
                      deleteMessage={`Are you sure you want to delete materialized column ${colInfo.columnName}?`}
                      title="Delete"
                      text="Delete"
                      outline={false}
                    />
                  </MoreMenu>
                )}
              </Flex>
            </Card>
          );
        })}
      </Box>
    </>
  );
}
