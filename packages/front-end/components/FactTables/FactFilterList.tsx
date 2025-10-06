import { FactTableInterface } from "back-end/types/fact-table";
import { useState } from "react";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import FactFilterModal from "./FactFilterModal";

export interface Props {
  factTable: FactTableInterface;
}

export default function FactFilterList({ factTable }: Props) {
  const [editOpen, setEditOpen] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const { mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();

  const { items, searchInputProps, isFiltered, SortableTH, clear, pagination } =
    useSearch({
      items: factTable?.filters || [],
      defaultSortField: "name",
      localStorageKey: "factFilters",
      searchFields: ["name^3", "description", "value^2"],
      pageSize: 10,
    });

  const canAddAndEdit = permissionsUtil.canCreateAndUpdateFactFilter(factTable);
  const canDelete = permissionsUtil.canDeleteFactFilter(factTable);

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
              canAddAndEdit
                ? ""
                : `You don't have permission to edit this fact table`
            }
          >
            <Button
              onClick={() => {
                if (!canAddAndEdit) return;
                setNewOpen(true);
              }}
              disabled={!canAddAndEdit}
            >
              Add Filter
            </Button>
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
                    <MoreMenu>
                      {canAddAndEdit && !filter.managedBy ? (
                        <button
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditOpen(filter.id);
                          }}
                        >
                          Edit
                        </button>
                      ) : null}
                      {canDelete && !filter.managedBy ? (
                        <DeleteButton
                          displayName="Filter"
                          className="dropdown-item text-danger"
                          useIcon={false}
                          text="Delete"
                          additionalMessage={
                            "This will remove the filter from all metrics that are using it."
                          }
                          onClick={async () => {
                            await apiCall(
                              `/fact-tables/${factTable.id}/filter/${filter.id}`,
                              {
                                method: "DELETE",
                              },
                            );
                            mutateDefinitions();
                          }}
                        />
                      ) : null}
                    </MoreMenu>
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
          {pagination}
        </>
      )}
    </>
  );
}
