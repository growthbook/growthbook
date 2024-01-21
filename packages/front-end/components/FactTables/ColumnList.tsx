import { FactTableInterface } from "back-end/types/fact-table";
import { useMemo, useState } from "react";
import { FaClock, FaUser } from "react-icons/fa";
import { BsArrowRepeat } from "react-icons/bs";
import { FaTriangleExclamation } from "react-icons/fa6";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "../Forms/Field";
import Tooltip from "../Tooltip/Tooltip";
import Button from "../Button";
import { GBEdit } from "../Icons";
import ColumnModal from "./ColumnModal";

export interface Props {
  factTable: FactTableInterface;
}

export default function ColumnList({ factTable }: Props) {
  const [editOpen, setEditOpen] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const { mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();

  const permissions = usePermissions();

  const availableColumns = useMemo(() => {
    return (factTable.columns || []).filter((col) => !col.deleted);
  }, [factTable]);

  const columns = useAddComputedFields(availableColumns, (column) => ({
    ...column,
    name: column.name || column.column,
    identifier: factTable.userIdTypes.includes(column.column),
    type:
      column.datatype === "number"
        ? column.numberFormat || "number"
        : column.datatype,
  }));

  const { items, searchInputProps, isFiltered, SortableTH, clear } = useSearch({
    items: columns,
    defaultSortField: "dateCreated",
    localStorageKey: "factColumns",
    searchFields: ["name^3", "description", "column^2"],
  });

  const canEdit = permissions.check(
    "manageFactTables",
    factTable.projects || ""
  );

  return (
    <>
      {newOpen && (
        <ColumnModal close={() => setNewOpen(false)} factTable={factTable} />
      )}
      {editOpen && (
        <ColumnModal
          close={() => setEditOpen("")}
          factTable={factTable}
          existing={factTable.columns.find((c) => c.column === editOpen)}
        />
      )}

      {factTable.columnsError && (
        <div className="alert alert-danger">
          <strong>
            {columns.length > 0
              ? "Error Updating Columns"
              : "Error Auto-detecting Columns"}
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
        <div className="col-auto">
          <Button
            color="link"
            onClick={async () => {
              await apiCall(`/fact-tables/${factTable.id}`, {
                method: "PUT",
                body: JSON.stringify({}),
              });
              mutateDefinitions();
            }}
          >
            <BsArrowRepeat style={{ marginTop: -1 }} /> Refresh
          </Button>
        </div>
      </div>
      {columns.some((col) => !col.deleted && col.datatype === "") && (
        <div className="alert alert-warning mt-2">
          Could not detect the data type for some columns. You can manually
          specify data types below. Only numeric columns can be used to create
          Metrics.
        </div>
      )}
      {columns.length > 0 ? (
        <table className="table appbox gbtable mt-2 mb-0">
          <thead>
            <tr>
              <SortableTH field="column">Column</SortableTH>
              <th></th>
              <SortableTH field="type">Type</SortableTH>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((col) => (
              <tr key={col.column}>
                <td>
                  {col.column}{" "}
                  {col.identifier && (
                    <Tooltip body="User Identifier Type">
                      <span className="badge badge-purple">
                        <FaUser />
                      </span>
                    </Tooltip>
                  )}
                  {col.column === "timestamp" && (
                    <Tooltip body="Main date field used for sorting and filtering">
                      <span className="badge badge-purple">
                        <FaClock />
                      </span>
                    </Tooltip>
                  )}
                </td>
                <td>{col.name !== col.column ? `"${col.name}"` : ""}</td>
                <td>
                  {col.datatype || "unknown"}{" "}
                  {col.datatype === "number" && col.numberFormat && (
                    <>({col.numberFormat})</>
                  )}
                  {col.datatype === "" && (
                    <Tooltip body="Unable to detect the data type. Edit this column to set one.">
                      <FaTriangleExclamation className="text-danger" />
                    </Tooltip>
                  )}
                </td>
                <td>
                  {canEdit && (
                    <button
                      className="btn btn-link btn-sm"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditOpen(col.column);
                      }}
                    >
                      <GBEdit />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && isFiltered && (
              <tr>
                <td colSpan={4} align={"center"}>
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
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="alert alert-warning mt-3">
          <strong>Unable to Auto-Detect Columns</strong>. Double check your SQL
          above to make sure it&apos;s correct and returning rows.
        </div>
      )}
    </>
  );
}
