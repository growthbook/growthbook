import {
  FactTableInterface,
  ColumnInterface,
  ColumnCachedExplorations,
} from "shared/types/fact-table";
import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { ago } from "shared/dates";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { EXPLORER_TYPE_LABELS } from "@/enterprise/components/ProductAnalytics/util";
import VirtualColumnModal from "./VirtualColumnModal";
import ColumnModal from "./ColumnModal";

// Cached explorations never block the delete, but they fail on their next run,
// so the modal lists them for the user to check first.
function DeleteVirtualColumnContent({
  factTableId,
  column,
}: {
  factTableId: string;
  column: string;
}) {
  const { data, error } = useApi<ColumnCachedExplorations>(
    `/fact-tables/${factTableId}/column/${encodeURIComponent(column)}/cached-explorations`,
  );
  const total = data?.total ?? 0;
  const explorations = data?.explorations ?? [];

  return (
    <Box>
      {error ? (
        <Callout status="warning" mb="3">
          Couldn&apos;t check for cached explorations that use this column. You
          can still delete the column.
        </Callout>
      ) : !data ? (
        <Flex align="center" gap="2" mb="3">
          <LoadingSpinner />
          <Text color="text-mid">Checking for cached explorations…</Text>
        </Flex>
      ) : total > 0 ? (
        <Callout status="warning" mb="3">
          <Text as="p" mb="1">
            {total} cached exploration{total === 1 ? " uses" : "s use"} this
            column and will fail the next time{" "}
            {total === 1 ? "it runs" : "they run"}. Open any you still need
            before you delete it.
          </Text>
          <Flex direction="column" gap="1">
            {explorations.map((e) => (
              <Text key={e.id}>
                <Link href={e.url} external>
                  {EXPLORER_TYPE_LABELS[e.datasetType]} exploration
                </Link>{" "}
                · last run {ago(e.dateUpdated)}
              </Text>
            ))}
            {total > explorations.length && (
              <Text>{total - explorations.length} more not shown</Text>
            )}
          </Flex>
        </Callout>
      ) : null}
      <Text as="p">
        This will remove the virtual column. Metrics or filters that reference
        it will need to be updated.
      </Text>
    </Box>
  );
}

function VirtualColumnRowMenu({
  column,
  factTableId,
  canEdit,
  canDelete,
  onEdit,
  onConfigureSlices,
}: {
  column: ColumnInterface;
  factTableId: string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onConfigureSlices: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const { hasCommercialFeature } = useUser();

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
        {canEdit &&
          hasCommercialFeature("metric-slices") &&
          (column.datatype === "string" || column.datatype === "boolean") && (
            <DropdownMenuItem
              onClick={() => {
                onConfigureSlices();
                setOpen(false);
              }}
            >
              Configure Auto Slices
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
                getConfirmationContent: async () => (
                  <DeleteVirtualColumnContent
                    factTableId={factTableId}
                    column={column.column}
                  />
                ),
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
  const [settingsOpen, setSettingsOpen] = useState("");

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

  // Virtual columns carry raw SQL, so they use the stricter gate that also
  // honors managedBy — matching what the back-end enforces.
  const canEdit = permissionsUtil.canManageFactTableVirtualColumn(factTable);

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
      {settingsOpen && (
        <ColumnModal
          close={() => setSettingsOpen("")}
          factTable={factTable}
          existing={virtualColumns.find((c) => c.column === settingsOpen)}
          slicesOnly
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
                      onConfigureSlices={() => setSettingsOpen(column.column)}
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
