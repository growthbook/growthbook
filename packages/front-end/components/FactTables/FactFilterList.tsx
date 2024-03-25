import { FactTableInterface } from "back-end/types/fact-table";
import { useState } from "react";
import { useAuth } from "@front-end/services/auth";
import { useSearch } from "@front-end/services/search";
import usePermissions from "@front-end/hooks/usePermissions";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import Field from "@front-end/components/Forms/Field";
import Tooltip from "@front-end/components/Tooltip/Tooltip";
import { GBAddCircle } from "@front-end/components/Icons";
import MoreMenu from "@front-end/components/Dropdown/MoreMenu";
import DeleteButton from "@front-end/components/DeleteButton/DeleteButton";
import InlineCode from "@front-end/components/SyntaxHighlighting/InlineCode";
import { OfficialBadge } from "@front-end/components/Metrics/MetricName";
import FactFilterModal from "./FactFilterModal";

export interface Props {
  factTable: FactTableInterface;
}

export default function FactFilterList({ factTable }: Props) {
  const [editOpen, setEditOpen] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const { mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();

  const permissions = usePermissions();

  const { items, searchInputProps, isFiltered, SortableTH, clear } = useSearch({
    items: factTable?.filters || [],
    defaultSortField: "name",
    localStorageKey: "factFilters",
    searchFields: ["name^3", "description", "value^2"],
  });

  const canEdit = permissions.check(
    "manageFactTables",
    factTable.projects || ""
  );

  return (
    <>
      {newOpen && (
        <FactFilterModal
          close={() => setNewOpen(false)}
          factTable={factTable}
        />
      )}
      {editOpen && (
        <FactFilterModal
          close={() => setEditOpen("")}
          factTable={factTable}
          existing={factTable.filters.find((f) => f.id === editOpen)}
        />
      )}

      <div className="row align-items-center">
        {factTable.filters.length > 0 && (
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
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                if (!canEdit) return;
                setNewOpen(true);
              }}
              disabled={!canEdit}
            >
              <GBAddCircle /> Add Filter
            </button>
          </Tooltip>
        </div>
      </div>
      {factTable.filters.length > 0 && (
        <>
          <table className="table appbox gbtable mt-2 mb-0">
            <thead>
              <tr>
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="value">Filter SQL</SortableTH>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((filter) => (
                <tr key={filter.id}>
                  <td style={{ verticalAlign: "top" }}>
                    {filter.name}
                    <OfficialBadge type="filter" managedBy={filter.managedBy} />
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <div style={{ marginTop: 2 }}>
                      <InlineCode language="sql" code={filter.value} />
                    </div>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    {canEdit && !filter.managedBy && (
                      <MoreMenu>
                        <button
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditOpen(filter.id);
                          }}
                        >
                          Edit
                        </button>
                        <DeleteButton
                          displayName="Filter"
                          className="dropdown-item"
                          useIcon={false}
                          text="Delete"
                          onClick={async () => {
                            await apiCall(
                              `/fact-tables/${factTable.id}/filter/${filter.id}`,
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
                  <td colSpan={3} align={"center"}>
                    No matching filters.{" "}
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
