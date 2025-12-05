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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
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
          <Table variant="standard" className="appbox mt-2 mb-0">
            <TableHeader>
              <TableRow>
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="value">Filter SQL</SortableTH>
                <TableColumnHeader style={{ width: 30 }}></TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((filter) => (
                <TableRow key={filter.id}>
                  <TableCell style={{ verticalAlign: "top" }}>
                    {filter.name}
                    <OfficialBadge type="filter" managedBy={filter.managedBy} />
                  </TableCell>
                  <TableCell style={{ verticalAlign: "top" }}>
                    <div style={{ marginTop: 2 }}>
                      <InlineCode language="sql" code={filter.value} />
                    </div>
                  </TableCell>
                  <TableCell style={{ verticalAlign: "top" }}>
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
                  </TableCell>
                </TableRow>
              ))}
              {!items.length && isFiltered && (
                <TableRow>
                  <TableCell colSpan={3} align={"center"}>
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
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {pagination}
        </>
      )}
    </>
  );
}
