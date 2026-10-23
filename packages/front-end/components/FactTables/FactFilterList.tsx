import {
  FactTableInterface,
  FactFilterInterface,
} from "shared/types/fact-table";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
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
import ExpandableBlock from "@/ui/ExpandableBlock";
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
                confirmationTitle: "Delete Saved Filter",
                cta: "Delete",
                getConfirmationContent: async () =>
                  "This will remove the Saved Filter from all metrics that are using it.",
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
  hideSearch?: boolean;
}

const FILTER_PAGE_SIZE = 10;

export default function FactFilterList({
  factTable,
  hideSearch = false,
}: Props) {
  const router = useRouter();
  const requestedFilterId =
    typeof router.query.filter === "string" ? router.query.filter : "";
  const [highlightedFilterId, setHighlightedFilterId] =
    useState(requestedFilterId);
  const [editOpen, setEditOpen] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const didJumpToFilter = useRef(false);

  const permissionsUtil = usePermissionsUtil();

  const {
    items,
    unpaginatedItems,
    searchInputProps,
    isFiltered,
    SortableTH,
    clear,
    pagination,
    page: currentPage,
    setPage,
  } = useSearch({
    items: factTable?.filters || [],
    defaultSortField: "name",
    localStorageKey: "factFilters",
    searchFields: ["name^3", "description", "value^2"],
    pageSize: FILTER_PAGE_SIZE,
  });

  const canAddAndEdit = permissionsUtil.canCreateAndUpdateFactFilter(factTable);
  const canDelete = permissionsUtil.canDeleteFactFilter(factTable);

  useEffect(() => {
    if (requestedFilterId) setHighlightedFilterId(requestedFilterId);
  }, [requestedFilterId]);

  // `?filter=<id>` deep-links one saved filter. The highlight is only a
  // landing cue: drop the query once the row is in view.
  useEffect(() => {
    if (!requestedFilterId || didJumpToFilter.current) return;
    const index = unpaginatedItems.findIndex(
      (filter) => filter.id === requestedFilterId,
    );
    if (index < 0) return;
    const page = Math.floor(index / FILTER_PAGE_SIZE) + 1;
    if (page !== currentPage) {
      setPage(page);
      return;
    }
    const row = document.getElementById(`fact-filter-${requestedFilterId}`);
    if (!row) return;
    didJumpToFilter.current = true;
    row.scrollIntoView({ block: "center" });
    const query = { ...router.query };
    delete query.filter;
    void router.replace(
      { pathname: router.pathname, query, hash: "filters" },
      undefined,
      { shallow: true },
    );
  }, [requestedFilterId, unpaginatedItems, currentPage, setPage, router]);

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
        {factTable.filters.length > 0 && !hideSearch && (
          <div className="col-auto mr-auto">
            <Field
              size="legacy"
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
              Add Saved Filter
            </Button>
          </Tooltip>
        </div>
      </div>
      {factTable.filters.length > 0 && (
        <>
          <table
            className="table appbox gbtable mt-2 mb-0"
            onPointerDown={() => setHighlightedFilterId("")}
            onKeyDown={() => setHighlightedFilterId("")}
          >
            <thead>
              <tr>
                <SortableTH field="name">Name</SortableTH>
                <SortableTH field="value">Filter SQL</SortableTH>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((filter) => (
                <tr
                  key={filter.id}
                  id={`fact-filter-${filter.id}`}
                  aria-current={
                    filter.id === highlightedFilterId ? "true" : undefined
                  }
                  style={
                    filter.id === highlightedFilterId
                      ? { backgroundColor: "var(--violet-a3)" }
                      : undefined
                  }
                >
                  <td style={{ verticalAlign: "top" }}>
                    {filter.name}
                    <OfficialBadge type="filter" managedBy={filter.managedBy} />
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <div style={{ marginTop: 2 }}>
                      <ExpandableBlock
                        maxHeight={160}
                        defaultExpanded={filter.id === highlightedFilterId}
                      >
                        <InlineCode language="sql" code={filter.value} />
                      </ExpandableBlock>
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
