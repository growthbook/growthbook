import { Box, Flex } from "@radix-ui/themes";
import { FactTableInterface } from "shared/types/fact-table";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import Button from "@/ui/Button";
import ExpandableBlock from "@/ui/ExpandableBlock";
import Link from "@/ui/Link";
import useFactFilterEditor from "@/hooks/useFactFilterEditor";

export interface Props {
  factTable: FactTableInterface;
}

const FILTER_PAGE_SIZE = 10;

export default function FactFilterList({ factTable }: Props) {
  const router = useRouter();
  const requestedFilterId =
    typeof router.query.filter === "string" ? router.query.filter : "";
  const [highlightedFilterId, setHighlightedFilterId] =
    useState(requestedFilterId);
  const editor = useFactFilterEditor(factTable);
  const didJumpToFilter = useRef(false);

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
      {editor.modal}

      <Flex align="center" gap="3">
        {factTable.filters.length > 0 && (
          <Field
            size="legacy"
            placeholder="Search..."
            type="search"
            {...searchInputProps}
          />
        )}
        <Box ml="auto">
          <Tooltip
            body={
              editor.canCreate
                ? ""
                : `You don't have permission to edit this fact table`
            }
          >
            <Button
              onClick={() => {
                if (!editor.canCreate) return;
                editor.openNew();
              }}
              disabled={!editor.canCreate}
            >
              New Saved Filter
            </Button>
          </Tooltip>
        </Box>
      </Flex>
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
                    {editor.canEdit(filter) ? (
                      <Link
                        weight="bold"
                        onClick={() => editor.openEdit(filter)}
                      >
                        {filter.name}
                      </Link>
                    ) : (
                      filter.name
                    )}
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
                </tr>
              ))}
              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={2} align={"center"}>
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
