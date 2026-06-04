import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import Link from "next/link";
import { date, datetime } from "shared/dates";
import { Revision, RevisionStatus } from "shared/enterprise";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import Pagination from "@/ui/Pagination";
import {
  SyntaxFilter,
  useAddComputedFields,
  useSearch,
} from "@/services/search";
import {
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { buildSavedGroupRevisionUrl } from "@/components/Revision/revisionUtils";
import { useRevisionsEntityType } from "@/hooks/useRevisions";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import {
  draftStatusDotColor,
  revisionStatusLabel,
} from "@/components/Features/RevisionStatusBadge";
import Text from "@/ui/Text";

const ITEMS_PER_PAGE = 10;

const DEFAULT_STATUSES: RevisionStatus[] = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
];

type ReviewRow = {
  id: string;
  title: string;
  comment: string;
  version: number | undefined;
  groupName: string;
  groupId: string;
  authorId: string;
  authorDisplay: string;
  status: RevisionStatus;
  dateCreated: Date;
  dateUpdated: Date;
  url: string;
};

function revisionToRow(revision: Revision): ReviewRow {
  const groupName = revision.target.snapshot?.groupName || revision.target.id;
  return {
    id: revision.id,
    title: revision.title || "",
    comment: revision.comment || "",
    version: revision.version,
    groupName,
    groupId: revision.target.id,
    authorId: revision.authorId,
    authorDisplay: "",
    status: revision.status,
    dateCreated: new Date(revision.dateCreated),
    dateUpdated: new Date(revision.dateUpdated),
    url: buildSavedGroupRevisionUrl(revision.target.id, revision),
  };
}

const COL = {
  REVISION: "5%",
  NOTES: "30%",
  AUTHOR: "15%",
  DATE: "13%",
  DRAFT_STATUS: "13%",
} as const;

const SavedGroupReviews: FC = () => {
  const router = useRouter();
  const { getUserDisplay } = useUser();

  // Server-side status filter — driven by the parsed search filters below so
  // that selecting a status from the FilterDropdown actually triggers a
  // refetch. Defaults to the "open" alias (non-merged/non-discarded) to keep
  // the payload bounded.
  const [serverStatusFilter, setServerStatusFilter] = useState<
    string | undefined
  >("open");
  const { revisions, isLoading } = useRevisionsEntityType("saved-group", {
    status: serverStatusFilter,
    limit: 500,
  });

  const rows: ReviewRow[] = useMemo(
    () => revisions.map(revisionToRow),
    [revisions],
  );

  const authors = useMemo(() => {
    const authorSet = new Set(rows.map((r) => r.authorId));
    return Array.from(authorSet).filter(Boolean);
  }, [rows]);

  const reviewItems = useAddComputedFields(rows, (item) => ({
    ...item,
    authorDisplay: item.authorDisplay || getUserDisplay(item.authorId) || "",
  }));

  const {
    items,
    searchInputProps,
    SortableTableColumnHeader,
    syntaxFilters,
    setSearchValue,
  } = useSearch({
    items: reviewItems,
    localStorageKey: "savedGroupReviewsList",
    defaultSortField: "dateUpdated",
    defaultSortDir: -1,
    searchFields: ["groupName", "authorId", "title", "authorDisplay"],
    searchTermFilters: {
      status: (item) => item.status,
      author: (item) => [item.authorId, item.authorDisplay],
    },
  });

  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });

  const hasExplicitStatusFilter = useMemo(
    () => syntaxFilters.some((f) => f.field === "status"),
    [syntaxFilters],
  );

  useEffect(() => {
    const f = syntaxFilters.find((x) => x.field === "status");
    let next: string | undefined;
    if (!f || f.values.length === 0) {
      next = DEFAULT_STATUSES.join(",");
    } else if (f.negated) {
      next = undefined;
    } else {
      next = f.values.join(",");
    }
    setServerStatusFilter((prev) => (prev === next ? prev : next));
  }, [syntaxFilters]);

  const statusFilteredItems = useMemo(() => {
    if (hasExplicitStatusFilter) return items;
    const allowed = new Set<string>(DEFAULT_STATUSES);
    return items.filter((item) => allowed.has(item.status));
  }, [items, hasExplicitStatusFilter]);

  const statusDropdownSyntaxFilters = useMemo<SyntaxFilter[]>(() => {
    if (hasExplicitStatusFilter) return syntaxFilters;
    return [
      ...syntaxFilters,
      {
        field: "status",
        values: [...DEFAULT_STATUSES],
        operator: "",
        negated: false,
      },
    ];
  }, [syntaxFilters, hasExplicitStatusFilter]);

  const updateStatusQuery = useCallback(
    (filter: SyntaxFilter) => {
      if (hasExplicitStatusFilter) {
        updateQuery(filter);
        return;
      }
      const clicked = filter.values[0];
      const nextStatuses = (DEFAULT_STATUSES as string[]).includes(clicked)
        ? DEFAULT_STATUSES.filter((s) => s !== clicked)
        : [...DEFAULT_STATUSES, clicked as RevisionStatus];
      const existing = searchInputProps.value.trim();
      const term =
        nextStatuses.length > 0 ? `status:${nextStatuses.join(",")}` : "";
      const combined = existing
        ? term
          ? `${existing} ${term}`
          : existing
        : term;
      setSearchValue(combined.trim());
    },
    [
      hasExplicitStatusFilter,
      updateQuery,
      searchInputProps.value,
      setSearchValue,
    ],
  );

  const [currentPage, setCurrentPage] = useState(1);

  // Reset to page 1 whenever the filtered/sorted list shrinks below the
  // current page's window so users don't end up stranded on an empty page
  // after narrowing filters.
  useEffect(() => {
    const lastPage = Math.max(
      1,
      Math.ceil(statusFilteredItems.length / ITEMS_PER_PAGE),
    );
    if (currentPage > lastPage) setCurrentPage(1);
  }, [statusFilteredItems.length, currentPage]);

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return statusFilteredItems.slice(start, start + ITEMS_PER_PAGE);
  }, [statusFilteredItems, currentPage]);

  const statusFilterItems = [
    {
      name: "Pending review",
      id: "pending-review",
      searchValue: "pending-review",
    },
    { name: "Approved", id: "approved", searchValue: "approved" },
    {
      name: "Changes requested",
      id: "changes-requested",
      searchValue: "changes-requested",
    },
    { name: "Draft", id: "draft", searchValue: "draft" },
  ];

  return (
    <Box mt="4">
      <Flex gap="4" align="start" justify="between" mb="4" wrap="wrap">
        <Box style={{ flexBasis: 300, flexShrink: 0 }}>
          <Field placeholder="Search..." type="search" {...searchInputProps} />
        </Box>
        <Flex gap="5" align="center">
          <FilterDropdown
            filter="author"
            heading="Author"
            syntaxFilters={syntaxFilters}
            open={dropdownFilterOpen}
            setOpen={setDropdownFilterOpen}
            items={authors.map((a) => ({
              name: getUserDisplay(a) || a,
              id: a,
              searchValue: getUserDisplay(a) || a,
            }))}
            updateQuery={updateQuery}
          />
          <FilterDropdown
            filter="status"
            heading="Status"
            syntaxFilters={statusDropdownSyntaxFilters}
            open={dropdownFilterOpen}
            setOpen={setDropdownFilterOpen}
            items={statusFilterItems}
            updateQuery={updateStatusQuery}
          />
        </Flex>
      </Flex>

      {isLoading ? (
        <LoadingOverlay />
      ) : statusFilteredItems.length === 0 ? (
        <Callout status="info">No drafts for saved groups.</Callout>
      ) : (
        <>
          <Table variant="list" stickyHeader roundedCorners>
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader field="groupName">
                  Saved Group
                </SortableTableColumnHeader>
                <TableColumnHeader
                  style={{ width: COL.REVISION, textAlign: "right" }}
                >
                  Revision
                </TableColumnHeader>
                <TableColumnHeader style={{ width: COL.NOTES }}>
                  Notes
                </TableColumnHeader>
                <SortableTableColumnHeader
                  field="authorDisplay"
                  style={{ width: COL.AUTHOR }}
                >
                  Author
                </SortableTableColumnHeader>
                <SortableTableColumnHeader
                  field="dateUpdated"
                  style={{ width: COL.DATE }}
                >
                  Last Modified
                </SortableTableColumnHeader>
                <TableColumnHeader style={{ width: COL.DRAFT_STATUS }}>
                  Draft Status
                </TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => router.push(row.url)}
                  style={{ cursor: "pointer" }}
                >
                  <TableCell style={{ padding: "var(--space-0)" }}>
                    <Link
                      href={row.url}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: "block",
                        color: "var(--gray-12)",
                        padding: "var(--space-3)",
                      }}
                    >
                      {row.groupName}
                    </Link>
                  </TableCell>
                  <TableCell style={{ textAlign: "right" }}>
                    {row.version ?? ""}
                  </TableCell>
                  <TableCell>
                    <OverflowText maxWidth={400}>{row.title}</OverflowText>
                  </TableCell>
                  <TableCell>{row.authorDisplay}</TableCell>
                  <TableCell title={datetime(row.dateUpdated)}>
                    {date(row.dateUpdated)}
                  </TableCell>
                  <TableCell>
                    <Flex align="center" style={{ gap: 6 }}>
                      <span
                        style={{
                          display: "block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: draftStatusDotColor(row.status),
                        }}
                      />
                      <Text size="medium">
                        {revisionStatusLabel(row.status)}
                      </Text>
                    </Flex>
                  </TableCell>
                </TableRow>
              ))}
              {paginatedItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} style={{ textAlign: "center" }}>
                    No matching drafts
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {statusFilteredItems.length > ITEMS_PER_PAGE && (
            <Pagination
              numItemsTotal={statusFilteredItems.length}
              perPage={ITEMS_PER_PAGE}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}
    </Box>
  );
};

export default SavedGroupReviews;
