import {
  FactTableInterface,
  FactFilterInterface,
} from "shared/types/fact-table";
import { useState } from "react";
import { IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import FactFilterModal from "./FactFilterModal";

function FactFilterRowMenu({
  filter,
  factTableId,
  canEdit,
  canDelete,
  onEdit,
}: {
  filter: FactFilterInterface;
  factTableId: string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();

  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
        >
          <BsThreeDotsVertical size={16} />
        </IconButton>
      }
      open={open}
      onOpenChange={setOpen}
      menuPlacement="end"
    >
      <DropdownMenuGroup>
        {canEdit && (
          <DropdownMenuItem
            onClick={() => {
              onEdit();
              setOpen(false);
            }}
          >
            Edit
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              color="red"
              confirmation={{
                confirmationTitle: "Delete Filter",
                cta: "Delete",
                getConfirmationContent: async () =>
                  "This will remove the filter from all metrics that are using it.",
                submit: async () => {
                  await apiCall(
                    `/fact-tables/${factTableId}/filter/${filter.id}`,
                    { method: "DELETE" },
                  );
                  mutateDefinitions();
                },
                closeDropdown: () => setOpen(false),
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </>
      )}
    </DropdownMenu>
  );
}

export interface Props {
  factTable: FactTableInterface;
}

export default function FactFilterList({ factTable }: Props) {
  const [editOpen, setEditOpen] = useState("");
  const [newOpen, setNewOpen] = useState(false);

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
                    <FactFilterRowMenu
                      filter={filter}
                      factTableId={factTable.id}
                      canEdit={canAddAndEdit && !filter.managedBy}
                      canDelete={canDelete && !filter.managedBy}
                      onEdit={() => setEditOpen(filter.id)}
                    />
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
