import { Flex, Box, Heading } from "@radix-ui/themes";
import {
  GrowthbookClickhouseDataSourceWithParams,
  MaterializedColumn,
} from "shared/types/datasource";
import { useMemo, useState } from "react";
import { FaPlus } from "react-icons/fa";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
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
    [dataSource.settings.materializedColumns],
  );
  const [addModal, setAddModal] = useState(false);
  const [editColumnIdx, setEditColumnIdx] = useState<number | undefined>(
    undefined,
  );
  const { apiCall } = useAuth();

  const deleteColumn = async (columnName: string) => {
    await apiCall(
      `/datasource/${dataSource.id}/materializedColumn/${columnName}`,
      { method: "DELETE" },
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
    column: MaterializedColumn,
  ) => {
    await apiCall(
      `/datasource/${dataSource.id}/materializedColumn/${columnName}`,
      {
        method: "PUT",
        body: JSON.stringify(column),
      },
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
            idx === editColumnIdx ? "" : c.columnName,
          )}
          existingSourceFields={materializedColumns.map((c, idx) =>
            idx === editColumnIdx ? "" : c.sourceField,
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
                Key Attributes
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
          Mark certain custom attributes in your events as important. These key
          attributes can be used as identifier types and dimensions in
          experiments.
        </p>

        {materializedColumns.length === 0 ? (
          <Callout status="info">No key attributes yet</Callout>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Attribute</TableColumnHeader>
                <TableColumnHeader>
                  SQL Column{" "}
                  <Tooltip body="The attribute will be stored in this column and available for querying" />
                </TableColumnHeader>
                <TableColumnHeader>Treat As</TableColumnHeader>
                <TableColumnHeader style={{ width: 50 }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {materializedColumns.map((col, idx) => (
                <TableRow key={col.sourceField}>
                  <TableCell>{col.sourceField}</TableCell>
                  <TableCell>{col.columnName}</TableCell>
                  <TableCell>
                    {col.type === "identifier"
                      ? "Identifier"
                      : col.type === "dimension"
                        ? "Dimension"
                        : `Other (${col.datatype})`}
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <MoreMenu>
                        <button
                          className="dropdown-item py-2"
                          onClick={() => setEditColumnIdx(idx)}
                        >
                          Edit
                        </button>
                        <DeleteButton
                          onClick={() => deleteColumn(col.columnName)}
                          className="dropdown-item text-danger py-2"
                          iconClassName="mr-2"
                          style={{ borderRadius: 0 }}
                          useIcon={false}
                          displayName={col.columnName}
                          deleteMessage={`Are you sure you want to delete this key attribute?`}
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
