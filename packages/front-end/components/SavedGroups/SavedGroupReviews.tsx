import { FC, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import Link from "next/link";
import { datetime } from "shared/dates";
import { Revision, RevisionStatus } from "shared/enterprise";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useUser } from "@/services/UserContext";
import Owner from "@/components/Avatar/Owner";
import Field from "@/components/Forms/Field";
import Pagination from "@/ui/Pagination";
import { useAddComputedFields, useSearch } from "@/services/search";
import {
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import {
  buildSavedGroupRevisionUrl,
  renderRevisionStatusCell,
} from "@/components/Revision/revisionUtils";
import { useRevisionsEntityType } from "@/hooks/useRevisions";
import Table, { TableBody, TableCell, TableHeader, TableRow } from "@/ui/Table";

const ITEMS_PER_PAGE = 10;

type ReviewRow = {
  id: string;
  title: string;
  groupName: string;
  groupId: string;
  authorId: string;
  authorDisplay: string;
  status: RevisionStatus;
  dateCreated: Date;
  url: string;
};

function revisionToRow(revision: Revision): ReviewRow {
  const groupName = revision.target.snapshot?.groupName || revision.target.id;
  return {
    id: revision.id,
    title: revision.title || "",
    groupName,
    groupId: revision.target.id,
    authorId: revision.authorId,
    authorDisplay: "",
    status: revision.status,
    dateCreated: new Date(revision.dateCreated),
    url: buildSavedGroupRevisionUrl(revision.target.id, revision),
  };
}

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

  const { items, searchInputProps, SortableTH, syntaxFilters, setSearchValue } =
    useSearch({
      items: reviewItems,
      localStorageKey: "savedGroupReviewsList",
      defaultSortField: "dateCreated",
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

  // Default to showing only actionable statuses on first render.
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (!defaultApplied.current && !router.query.q) {
      setSearchValue("status:draft,pending-review,approved,changes-requested");
      defaultApplied.current = true;
    }
  }, [router.query.q, setSearchValue]);

  // Mirror the parsed status filter back to the server fetch so explicit
  // status selections actually narrow the underlying request. "open" is the
  // bounded default; a negated filter falls back to undefined since the server
  // can't easily express NOT-in (the client filter still narrows the view).
  useEffect(() => {
    const f = syntaxFilters.find((x) => x.field === "status");
    let next: string | undefined;
    if (!f || f.values.length === 0) {
      next = "open";
    } else if (f.negated) {
      next = undefined;
    } else {
      next = f.values.join(",");
    }
    setServerStatusFilter((prev) => (prev === next ? prev : next));
  }, [syntaxFilters]);

  const [currentPage, setCurrentPage] = useState(1);

  // Reset to page 1 whenever the filtered/sorted list shrinks below the
  // current page's window so users don't end up stranded on an empty page
  // after narrowing filters.
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
    if (currentPage > lastPage) setCurrentPage(1);
  }, [items.length, currentPage]);

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return items.slice(start, start + ITEMS_PER_PAGE);
  }, [items, currentPage]);

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
    { name: "Published", id: "merged", searchValue: "merged" },
    { name: "Discarded", id: "discarded", searchValue: "discarded" },
  ];

  return (
    <Box mt="4" mb="5" p="4" className="appbox">
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          <h2 className="mb-0">Reviews</h2>
        </div>
      </div>
      <p className="text-gray mb-3">
        Open review requests for saved groups across your organization.
      </p>

      <Flex gap="4" align="start" justify="between" mb="4" wrap="wrap">
        <Box style={{ flexBasis: 300, flexShrink: 0 }}>
          <Field placeholder="Search..." type="search" {...searchInputProps} />
        </Box>
        <Flex gap="5" align="center">
          <FilterDropdown
            filter="author"
            heading="Requested by"
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
            syntaxFilters={syntaxFilters}
            open={dropdownFilterOpen}
            setOpen={setDropdownFilterOpen}
            items={statusFilterItems}
            updateQuery={updateQuery}
          />
        </Flex>
      </Flex>

      {isLoading ? (
        <LoadingOverlay />
      ) : items.length === 0 ? (
        <Callout status="info">No reviews for saved groups.</Callout>
      ) : (
        <>
          <Table variant="list" roundedCorners stickyHeader={false}>
            <TableHeader>
              <TableRow>
                <SortableTH field="title">Revision</SortableTH>
                <SortableTH field="groupName">Saved Group</SortableTH>
                <SortableTH field="authorDisplay">Requested by</SortableTH>
                <SortableTH field="dateCreated">Date Requested</SortableTH>
                <SortableTH field="status">Status</SortableTH>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.map((row) => (
                <TableRow
                  key={row.id}
                  className="hover-highlight"
                  onClick={() => router.push(row.url)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(row.url);
                    }
                  }}
                  tabIndex={0}
                  role="link"
                  aria-label={row.title || row.groupName}
                  style={{ cursor: "pointer" }}
                >
                  <TableCell>
                    <Link
                      href={row.url}
                      // Stop propagation so the row-level onClick doesn't also
                      // fire (which would trigger `router.push` a second time).
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        textDecoration: "none",
                        color: "inherit",
                        display: "block",
                      }}
                    >
                      {row.title || (
                        <span className="text-muted">Untitled</span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>{row.groupName}</TableCell>
                  <TableCell>
                    <Owner ownerId={row.authorId} />
                  </TableCell>
                  <TableCell>{datetime(row.dateCreated)}</TableCell>
                  <TableCell>{renderRevisionStatusCell(row.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {items.length > ITEMS_PER_PAGE && (
            <Pagination
              numItemsTotal={items.length}
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
