import { FactTableInterface } from "back-end/types/fact-table";
import { useMemo, useState } from "react";
import { FaClock, FaFilter, FaUser, FaLayerGroup } from "react-icons/fa";
import { BsArrowRepeat } from "react-icons/bs";
import { FaTriangleExclamation } from "react-icons/fa6";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import { GBEdit } from "@/components/Icons";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ColumnModal from "./ColumnModal";

export interface Props {
  factTable: FactTableInterface;
}

export default function ColumnList({ factTable }: Props) {
  const [editOpen, setEditOpen] = useState("");

  const { mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();

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

  const canEdit = permissionsUtil.canViewEditFactTableModal(factTable);

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
        <div className="col-auto">
          <Button
            color="link"
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
        <>
          <table className="table table-tiny appbox gbtable mt-2 mb-0">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
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
                    {col.isDimension && (
                      <Tooltip body="Dimension">
                        <span className="badge badge-purple">
                          <FaLayerGroup />
                        </span>
                      </Tooltip>
                    )}
                    {col.alwaysInlineFilter && (
                      <Tooltip body="Prompt all metrics to filter on this column">
                        <span className="badge badge-purple">
                          <FaFilter />
                        </span>
                      </Tooltip>
                    )}
                  </td>
                  <td>{col.column}</td>
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
