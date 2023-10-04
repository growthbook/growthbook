import { FactTableInterface } from "back-end/types/fact-table";
import { useState } from "react";
import { FaClock, FaUser } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "../Forms/Field";
import Tooltip from "../Tooltip/Tooltip";
import { GBAddCircle } from "../Icons";
import MoreMenu from "../Dropdown/MoreMenu";
import DeleteButton from "../DeleteButton/DeleteButton";
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

  const columns = useAddComputedFields(factTable.columns || [], (column) => ({
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
          <Tooltip
            body={
              canEdit ? "" : `You don't have permission to edit this fact table`
            }
          >
            <button
              className={
                columns.length > 0 ? "btn btn-link" : "btn btn-primary"
              }
              onClick={(e) => {
                e.preventDefault();
                if (!canEdit) return;
                setNewOpen(true);
              }}
              disabled={!canEdit}
            >
              <GBAddCircle /> Add Column
            </button>
          </Tooltip>
        </div>
      </div>
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
                  {col.datatype}{" "}
                  {col.datatype === "number" && col.numberFormat && (
                    <>({col.numberFormat})</>
                  )}
                </td>
                <td>
                  {canEdit && (
                    <MoreMenu>
                      <button
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setEditOpen(col.column);
                        }}
                      >
                        Edit
                      </button>
                      <DeleteButton
                        displayName="Column"
                        className="dropdown-item"
                        useIcon={false}
                        text="Delete"
                        onClick={async () => {
                          await apiCall(
                            `/fact-tables/${factTable.id}/column/${col.column}`,
                            {
                              method: "DELETE",
                            }
                          );
                          mutateDefinitions();
                        }}
                      />
                    </MoreMenu>
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
          above to make sure it&apos;s correct and returning rows. If it&apos;s
          still not working, you can manually define your columns here.
        </div>
      )}
    </>
  );
}
