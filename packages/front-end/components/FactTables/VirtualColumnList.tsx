import { FactTableInterface, ColumnInterface } from "shared/types/fact-table";
import { useState } from "react";
import { IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import VirtualColumnModal from "./VirtualColumnModal";

function VirtualColumnRowMenu({
  column,
  factTableId,
  canEdit,
  canDelete,
  onEdit,
}: {
  column: ColumnInterface;
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
                confirmationTitle: "Delete Virtual Column",
                cta: "Delete",
                getConfirmationContent: async () =>
                  "This will remove the virtual column. Metrics or filters that reference it will need to be updated.",
                submit: async () => {
                  await apiCall(
                    `/fact-tables/${factTableId}/column/${column.column}`,
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

export default function VirtualColumnList({ factTable }: Props) {
  const [editOpen, setEditOpen] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const permissionsUtil = usePermissionsUtil();

  const virtualColumns = (factTable.columns || [])
    .filter((c) => c.isVirtual && !c.deleted)
    .map((c) => ({ ...c, id: c.column }));

  const { items, searchInputProps, isFiltered, SortableTH, clear, pagination } =
    useSearch({
      items: virtualColumns,
      defaultSortField: "name",
      localStorageKey: "virtualColumns",
      searchFields: ["name^3", "description", "sql^2"],
      pageSize: 10,
    });

  const canEdit = permissionsUtil.canUpdateFactTable(factTable, {
    columns: [],
  });

  return (
    <>
      {newOpen && (
        <VirtualColumnModal
          close={() => setNewOpen(false)}
          factTable={factTable}
        />
      )}
      {editOpen && (
        <VirtualColumnModal
          close={() => setEditOpen("")}
          factTable={factTable}
          existing={virtualColumns.find((c) => c.column === editOpen)}
        />
      )}

      <div className="row align-items-center">
        {virtualColumns.length > 0 && (
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
            <Button
              onClick={() => {
                if (!canEdit) return;
                setNewOpen(true);
              }}
              disabled={!canEdit}
            >
              Add Virtual Column
            </Button>
          </Tooltip>
        </div>
      </div>
      {virtualColumns.length > 0 && (
        <>
          <table className="table appbox gbtable mt-2 mb-0">
            <thead>
              <tr>
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="sql">Expression</SortableTH>
                <SortableTH field="datatype">Type</SortableTH>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((column) => (
                <tr key={column.column}>
                  <td style={{ verticalAlign: "top" }}>{column.name}</td>
                  <td style={{ verticalAlign: "top" }}>
                    <div style={{ marginTop: 2 }}>
                      <InlineCode language="sql" code={column.sql || ""} />
                    </div>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    {column.datatype || "unknown"}
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <VirtualColumnRowMenu
                      column={column}
                      factTableId={factTable.id}
                      canEdit={canEdit}
                      canDelete={canEdit}
                      onEdit={() => setEditOpen(column.column)}
                    />
                  </td>
                </tr>
              ))}
              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={4} align={"center"}>
                    No matching virtual columns.{" "}
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
