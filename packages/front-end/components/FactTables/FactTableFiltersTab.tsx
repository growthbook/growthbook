import { FactTableInterface } from "shared/types/fact-table";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Flex } from "@radix-ui/themes";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import useFactFilterEditor from "@/hooks/useFactFilterEditor";
import { useSearch } from "@/services/search";
import Button from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import Link from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import styles from "./FactTableDetailsPage.module.scss";

const PAGE_SIZE = 20;

export default function FactTableFiltersTab({
  factTable,
}: {
  factTable: FactTableInterface;
}) {
  const editor = useFactFilterEditor(factTable);

  // `?filter=<id>` deep-links one Saved Filter. The highlight is only a
  // landing cue: drop the query once the row is in view.
  const router = useRouter();
  const linkedId =
    typeof router.query.filter === "string" ? router.query.filter : "";
  const [highlightId, setHighlightId] = useState(linkedId);
  const linkedRow = useRef<HTMLTableRowElement>(null);

  const {
    items,
    unpaginatedItems,
    searchInputProps,
    SortableTableColumnHeader,
    pagination,
    page,
    setPage,
  } = useSearch({
    items: factTable.filters,
    defaultSortField: "name",
    localStorageKey: "factTableFiltersTab",
    searchFields: ["name^3", "description", "value^2"],
    pageSize: PAGE_SIZE,
    // The Metrics tab on this page searches too, so neither owns ?q=
    disableUrlSearchTerm: true,
  });

  // Turn to the linked filter's page first, then scroll to it
  const jumpedTo = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedId) {
      jumpedTo.current = null;
      return;
    }
    if (jumpedTo.current === linkedId) return;
    const index = unpaginatedItems.findIndex((f) => f.id === linkedId);
    if (index < 0) return;
    const target = Math.floor(index / PAGE_SIZE) + 1;
    if (target !== page) {
      setPage(target);
      return;
    }
    jumpedTo.current = linkedId;
    setHighlightId(linkedId);
    linkedRow.current?.scrollIntoView({ block: "center" });
    const query = { ...router.query };
    delete query.filter;
    void router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  }, [linkedId, unpaginatedItems, page, setPage, router]);

  return (
    <Flex direction="column" gap="3">
      {editor.modal}
      <Flex justify="between" align="center" gap="3">
        {factTable.filters.length ? (
          <TextField
            size="sm"
            type="search"
            placeholder={`Search ${factTable.filters.length} Saved Filters`}
            {...searchInputProps}
          />
        ) : (
          <span />
        )}
        {editor.canCreate ? (
          <Button size="sm" variant="outline" onClick={editor.openNew}>
            New Saved Filter
          </Button>
        ) : null}
      </Flex>
      {items.length ? (
        <Table
          variant="list"
          roundedCorners
          onPointerDown={() => setHighlightId("")}
          onKeyDown={() => setHighlightId("")}
        >
          <TableHeader>
            <TableRow>
              <SortableTableColumnHeader field="name">
                Name
              </SortableTableColumnHeader>
              <TableColumnHeader>Filter SQL</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((filter) => (
              <TableRow
                key={filter.id}
                align="center"
                ref={filter.id === linkedId ? linkedRow : undefined}
                aria-current={filter.id === highlightId ? "true" : undefined}
                className={
                  filter.id === highlightId ? styles.highlightRow : undefined
                }
              >
                <TableCell>
                  {editor.canEdit(filter) ? (
                    <Link weight="bold" onClick={() => editor.openEdit(filter)}>
                      {filter.name}
                    </Link>
                  ) : (
                    filter.name
                  )}
                  <OfficialBadge type="filter" managedBy={filter.managedBy} />
                </TableCell>
                <TableCell>
                  <InlineCode language="sql" code={filter.value} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Text color="text-mid">
          {factTable.filters.length
            ? "No Saved Filters match your search."
            : "No Saved Filters on this Fact Table yet."}
        </Text>
      )}
      {pagination}
    </Flex>
  );
}
