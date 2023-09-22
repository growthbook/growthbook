import { FactTableInterface } from "back-end/types/fact-table";
import { useState } from "react";
import { date } from "shared/dates";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "../Forms/Field";
import Tooltip from "../Tooltip/Tooltip";
import { GBAddCircle } from "../Icons";
import MoreMenu from "../Dropdown/MoreMenu";
import DeleteButton from "../DeleteButton/DeleteButton";
import InlineCode from "../SyntaxHighlighting/InlineCode";
import FactModal from "./FactModal";

export interface Props {
  factTable: FactTableInterface;
}

export default function FactList({ factTable }: Props) {
  const [editFactOpen, setEditFactOpen] = useState("");
  const [newFactOpen, setNewFactOpen] = useState(false);

  const { mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();

  const permissions = usePermissions();

  const { items, searchInputProps, isFiltered, SortableTH, clear } = useSearch({
    items: factTable?.facts || [],
    defaultSortField: "name",
    localStorageKey: "facts",
    searchFields: ["name^3", "description", "column^2"],
  });

  const canEdit = permissions.check(
    "manageFactTables",
    factTable.projects || ""
  );

  return (
    <>
      {newFactOpen && (
        <FactModal close={() => setNewFactOpen(false)} factTable={factTable} />
      )}
      {editFactOpen && (
        <FactModal
          close={() => setEditFactOpen("")}
          factTable={factTable}
          existing={factTable.facts.find((f) => f.id === editFactOpen)}
        />
      )}

      <div className="row align-items-center">
        {factTable.facts.length > 0 && (
          <div className="col-lg-3 col-md-4 col-6 mr-auto">
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
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                if (!canEdit) return;
                setNewFactOpen(true);
              }}
              disabled={!canEdit}
            >
              <GBAddCircle /> Add Fact
            </button>
          </Tooltip>
        </div>
      </div>
      {factTable.facts.length > 0 && (
        <>
          <table className="table appbox gbtable mt-2 mb-0">
            <thead>
              <tr>
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="column">Column</SortableTH>
                <th>Format</th>
                <th>Filters</th>
                <SortableTH field="dateUpdated">Last Updated</SortableTH>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((fact) => (
                <tr key={fact.id}>
                  <td>{fact.name}</td>
                  <td>
                    <InlineCode language="sql" code={fact.column} />
                  </td>
                  <td>{fact.numberFormat}</td>
                  <td>
                    {fact.filters.map((filterId) => (
                      <span
                        key={filterId}
                        className="badge badge-secondary mr-1"
                      >
                        {factTable.filters.find((f) => f.id === filterId)
                          ?.name || filterId}
                      </span>
                    ))}
                  </td>
                  <td>{date(fact.dateUpdated)}</td>
                  <td>
                    {canEdit && (
                      <MoreMenu>
                        <button
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditFactOpen(fact.id);
                          }}
                        >
                          Edit
                        </button>
                        <DeleteButton
                          displayName="Fact"
                          className="dropdown-item"
                          useIcon={false}
                          text="Delete"
                          onClick={async () => {
                            await apiCall(
                              `/fact-tables/${factTable.id}/fact/${fact.id}`,
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
                  <td colSpan={8} align={"center"}>
                    No matching facts.{" "}
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
        </>
      )}
    </>
  );
}
