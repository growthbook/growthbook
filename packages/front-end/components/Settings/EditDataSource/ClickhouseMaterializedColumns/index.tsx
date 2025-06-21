import { Flex, Box, Heading } from "@radix-ui/themes";
import {
  GrowthbookClickhouseDataSourceWithParams,
  MaterializedColumn,
} from "back-end/types/datasource";
import { useMemo, useState } from "react";
import { FaPlus } from "react-icons/fa";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Badge from "@/components/Radix/Badge";
import Button from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/components/Radix/Table";
import { useAuth } from "@/services/auth";
import { DataSourceQueryEditingModalBaseProps } from "../types";
import AddEditMaterializedColumnsModal from "./AddEditMaterializedColumnsModal";

type ClickhouseMaterializedColumnsProps = Omit<
  DataSourceQueryEditingModalBaseProps,
  "dataSource" | "onSave"
> & {
  dataSource: GrowthbookClickhouseDataSourceWithParams;
  mutate: () => Promise<void>;
};

export default function ClickhouseMaterializedColumns({
  dataSource,
  canEdit,
  mutate,
}: ClickhouseMaterializedColumnsProps) {
  const materializedColumns = useMemo(
    () => dataSource.settings.materializedColumns || [],
    [dataSource.settings.materializedColumns]
  );
  const [addModal, setAddModal] = useState(false);
  const [editColumnIdx, setEditColumnIdx] = useState<number | undefined>(
    undefined
  );
  const { apiCall } = useAuth();

  const deleteColumn = async (columnName: string) => {
    await apiCall(
      `/datasource/${dataSource.id}/materializedColumn/${columnName}`,
      { method: "DELETE" }
    );
    await mutate();
  };

  const createColumn = async (column: MaterializedColumn) => {
    await apiCall(`/datasource/${dataSource.id}/materializedColumn`, {
      method: "POST",
      body: JSON.stringify(column),
    });
    await mutate();
  };

  const updateColumn = async (
    columnName: string,
    column: MaterializedColumn
  ) => {
    await apiCall(
      `/datasource/${dataSource.id}/materializedColumn/${columnName}`,
      {
        method: "PUT",
        body: JSON.stringify(column),
      }
    );
    await mutate();
  };

  const refreshColumns = async (factTableId: string) => {
    await apiCall(`/fact-tables/${factTableId}?forceColumnRefresh=true`, {
      method: "PUT",
    });
    await mutate();
  };

  return (
    <>
      {addModal && (
        <AddEditMaterializedColumnsModal
          mode="add"
          column={undefined}
          existingColumnNames={materializedColumns.map((c) => c.columnName)}
          existingSourceFields={materializedColumns.map((c) => c.sourceField)}
          onSave={createColumn}
          onCancel={() => {
            setAddModal(false);
          }}
          refreshColumns={refreshColumns}
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
          onSave={(column) =>
            updateColumn(materializedColumns[editColumnIdx].columnName, column)
          }
          onCancel={() => {
            setEditColumnIdx(undefined);
          }}
          refreshColumns={refreshColumns}
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
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Source Field</TableColumnHeader>
                <TableColumnHeader>Datatype</TableColumnHeader>
                <TableColumnHeader>Destination Column</TableColumnHeader>
                <TableColumnHeader />
              </TableRow>
            </TableHeader>
            <TableBody>
              {materializedColumns.map((col, idx) => (
                <TableRow key={col.sourceField}>
                  <TableCell>{col.sourceField}</TableCell>
                  <TableCell>{col.datatype}</TableCell>
                  <TableCell>{col.columnName}</TableCell>
                  <TableCell>
                    {canEdit && (
                      <MoreMenu>
                        <button
                          className="dropdown-item py-2"
                          onClick={() => setEditColumnIdx(idx)}
                        >
                          Edit Materialized Column
                        </button>
                        <DeleteButton
                          onClick={() => deleteColumn(col.columnName)}
                          className="dropdown-item text-danger py-2"
                          iconClassName="mr-2"
                          style={{ borderRadius: 0 }}
                          useIcon={false}
                          displayName={col.columnName}
                          deleteMessage={`Are you sure you want to delete materialized column ${col.columnName}?`}
                          title="Delete"
                          text="Delete"
                          outline={false}
                        />
                      </MoreMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>
    </>
  );
}
