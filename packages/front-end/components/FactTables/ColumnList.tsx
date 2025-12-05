import { FactTableInterface } from "back-end/types/fact-table";
import { useMemo, useState } from "react";
import {
  PiUserBold,
  PiClockBold,
  PiStackBold,
  PiFunnelBold,
  PiPencilSimpleFill,
} from "react-icons/pi";
import { FaTriangleExclamation } from "react-icons/fa6";
import { IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Avatar from "@/ui/Avatar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import ColumnModal from "./ColumnModal";

export interface Props {
  factTable: FactTableInterface;
  canEdit?: boolean;
}

export default function ColumnList({ factTable, canEdit = false }: Props) {
  const [editOpen, setEditOpen] = useState("");
  const { mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();

  const availableColumns = useMemo(() => {
    return (factTable.columns || []).filter((col) => !col.deleted);
  }, [factTable]);

  const columns = useAddComputedFields(availableColumns, (column) => ({
    ...column,
    name: column.name || column.column,
    id: column.name || column.column,
    identifier: factTable.userIdTypes.includes(column.column),
    type:
      column.datatype === "number"
        ? column.numberFormat || "number"
        : column.datatype,
  }));

  const { items, searchInputProps, isFiltered, SortableTH, clear, pagination } =
    useSearch({
      items: columns,
      defaultSortField: "dateCreated",
      localStorageKey: "factColumns",
      searchFields: ["name^3", "description", "column^2"],
      pageSize: 10,
    });

  const existing = editOpen
    ? factTable.columns.find((c) => c.column === editOpen)
    : null;

  return (
    <>
      {existing ? (
        <ColumnModal
          close={() => setEditOpen("")}
          factTable={factTable}
          existing={existing}
        />
      ) : null}

      {factTable.columnsError && (
        <div className="alert alert-danger">
          <strong>
            Error {columns.length > 0 ? "Refreshing" : "Detecting"} Columns
          </strong>
          : {factTable.columnsError}
        </div>
      )}

      <div className="row align-items-center">
        {columns.length > 0 && (
          <div className="col-auto mr-auto">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </div>
        )}
        {canEdit && (
          <div className="col-auto">
            <Button
              size="xs"
              variant="outline"
              onClick={async () => {
                await apiCall(
                  `/fact-tables/${factTable.id}?forceColumnRefresh=1`,
                  {
                    method: "PUT",
                    body: JSON.stringify({}),
                  },
                );
                mutateDefinitions();
              }}
            >
              Refresh
            </Button>
          </div>
        )}
      </div>
      {columns.some((col) => !col.deleted && col.datatype === "") && (
        <div className="alert alert-warning mt-2">
          Could not detect the data type for some columns. You can manually
          specify data types below. Only numeric columns can be used to create
          Metrics.
        </div>
      )}
      {columns.length > 0 ? (
        <>
          <Table variant="standard" className="table-tiny appbox mt-2 mb-0">
            <TableHeader>
              <TableRow>
                <TableColumnHeader style={{ width: 30 }}></TableColumnHeader>
                <SortableTH field="column">Column</SortableTH>
                <TableColumnHeader></TableColumnHeader>
                <SortableTH field="type">Type</SortableTH>
                <TableColumnHeader style={{ width: 30 }}></TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((col) => (
                <TableRow key={col.column}>
                  <TableCell>
                    <div
                      className="d-flex align-items-center"
                      style={{ minHeight: 32 }}
                    >
                      {col.identifier && (
                        <Tooltip body="User Identifier Type" tipPosition="left">
                          <Avatar
                            size="sm"
                            color="violet"
                            variant="soft"
                            radius="small"
                          >
                            <PiUserBold size={14} />
                          </Avatar>
                        </Tooltip>
                      )}
                      {col.column === "timestamp" && (
                        <Tooltip
                          body="Main date field used for sorting and filtering"
                          tipPosition="left"
                        >
                          <Avatar
                            size="sm"
                            color="violet"
                            variant="soft"
                            radius="small"
                          >
                            <PiClockBold size={14} />
                          </Avatar>
                        </Tooltip>
                      )}
                      {col.isAutoSliceColumn && (
                        <div style={{ position: "relative" }}>
                          <Tooltip
                            body={
                              (!col.autoSlices ||
                                col.autoSlices.length === 0) &&
                              col.datatype !== "boolean"
                                ? "Auto slices enabled, no slice levels configured"
                                : "Auto slices enabled"
                            }
                            tipPosition="left"
                          >
                            <Avatar
                              size="sm"
                              color="violet"
                              variant="soft"
                              radius="small"
                            >
                              <PiStackBold size={14} />
                            </Avatar>
                          </Tooltip>
                          {(!col.autoSlices ||
                            (col.autoSlices.length === 0 &&
                              col.datatype !== "boolean")) && (
                            <div
                              style={{
                                position: "absolute",
                                top: -2,
                                right: -2,
                                width: 8,
                                height: 8,
                                backgroundColor: "var(--red-10)",
                                borderRadius: "50%",
                                border: "1px solid white",
                              }}
                            />
                          )}
                        </div>
                      )}
                      {col.alwaysInlineFilter && (
                        <Tooltip
                          body="Prompt all metrics to filter on this column"
                          tipPosition="left"
                        >
                          <Avatar
                            size="sm"
                            color="violet"
                            variant="soft"
                            radius="small"
                          >
                            <PiFunnelBold size={14} />
                          </Avatar>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{col.column}</TableCell>
                  <TableCell>{col.name !== col.column ? `"${col.name}"` : ""}</TableCell>
                  <TableCell>
                    {col.datatype || "unknown"}{" "}
                    {col.datatype === "number" && col.numberFormat && (
                      <>({col.numberFormat})</>
                    )}
                    {col.datatype === "" && (
                      <Tooltip body="Unable to detect the data type. Edit this column to set one.">
                        <FaTriangleExclamation className="text-danger" />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="d-flex align-items-center px-1">
                      {canEdit && (
                        <IconButton
                          size="2"
                          variant="ghost"
                          onClick={() => {
                            setEditOpen(col.column);
                          }}
                        >
                          <PiPencilSimpleFill size={14} />
                        </IconButton>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!items.length && isFiltered && (
                <TableRow>
                  <TableCell colSpan={4} align={"center"}>
                    No matching columns.{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        clear();
                      }}
                    >
                      Clear search field
                    </a>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {pagination}
        </>
      ) : (
        <div className="alert alert-warning mt-3">
          <strong>Unable to Auto-Detect Columns</strong>. Double check your SQL
          above to make sure it&apos;s correct and returning rows.
        </div>
      )}
    </>
  );
}
