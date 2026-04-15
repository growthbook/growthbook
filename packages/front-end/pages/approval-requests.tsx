import { FC, useEffect, useMemo, useRef, useState } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { datetime } from "shared/dates";
import { Revision, RevisionStatus } from "shared/enterprise";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { FeatureMetaInfo } from "shared/types/feature";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import UserAvatar from "@/components/Avatar/UserAvatar";
import Field from "@/components/Forms/Field";
import Pagination from "@/components/Pagination";
import { useAddComputedFields, useSearch } from "@/services/search";
import {
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import { useRevisions } from "@/hooks/useRevisions";
import useApi from "@/hooks/useApi";

const ITEMS_PER_PAGE = 10;

type FeatureRevisionWithMeta = FeatureRevisionInterface & {
  featureMeta?: FeatureMetaInfo;
};

// Unified row shape so saved-group revisions and feature revisions can be
// listed/filtered/sorted together.
type ApprovalRow = {
  id: string;
  title: string;
  entityName: string;
  entityType: string;
  authorId: string;
  authorDisplay: string;
  status: RevisionStatus;
  dateCreated: Date;
  url: string;
};

function getEntityTypeLabel(entityType: string): string {
  const labels: Record<string, string> = {
    "saved-group": "Saved Group",
    feature: "Feature",
  };
  return labels[entityType] || entityType;
}

function revisionToRow(revision: Revision): ApprovalRow {
  const entityName =
    revision.target.type === "saved-group"
      ? revision.target.snapshot?.groupName || revision.target.id
      : revision.target.id;

  return {
    id: revision.id,
    title: revision.title || "",
    entityName,
    entityType: revision.target.type,
    authorId: revision.authorId,
    authorDisplay: "",
    status: revision.status,
    dateCreated: new Date(revision.dateCreated),
    url: `/saved-groups/${revision.target.id}?flow=${revision.id}`,
  };
}

function featureRevisionToRow(
  revision: FeatureRevisionWithMeta,
): ApprovalRow | null {
  // Only show revisions with an identifiable logged-in author (matches the
  // shape expected by the "Requested by" column).
  const createdBy = revision.createdBy;
  const authorId =
    createdBy && createdBy.type === "dashboard" ? createdBy.id : "";
  const authorDisplay =
    createdBy && createdBy.type === "dashboard" ? createdBy.name : "";

  // Feature revisions use "published" where unified revisions use "merged".
  const status: RevisionStatus =
    revision.status === "published" ? "merged" : revision.status;

  return {
    id: `${revision.featureId}-v${revision.version}`,
    title: revision.title || revision.comment || "",
    entityName: revision.featureId,
    entityType: "feature",
    authorId,
    authorDisplay,
    status,
    dateCreated: new Date(revision.dateCreated),
    url: `/features/${revision.featureId}?v=${revision.version}`,
  };
}

const ApprovalRequests: FC = () => {
  const router = useRouter();
  const { getUserDisplay, hasCommercialFeature } = useUser();
  const hasFeature = hasCommercialFeature("require-approvals");
  // Server-side status filter is driven by the page's local search filter
  // state (see the useEffect below) so that selecting a status from the
  // FilterDropdown actually triggers a refetch. Defaults to the "open" alias
  // (non-merged/non-discarded) to keep the inbox payload bounded.
  const [serverStatusFilter, setServerStatusFilter] = useState<
    string | undefined
  >("open");
  const { revisions, isLoading: revisionsLoading } = useRevisions({
    status: serverStatusFilter,
    limit: 500,
  });
  const { data: featureRevisionsData, error: featureRevisionsError } = useApi<{
    revisions: FeatureRevisionWithMeta[];
  }>(`/revision/feature?sparse=true`);

  // Don't block the page on the feature-revisions request — if it errors or is
  // slow, still render the saved-group revisions we already have.
  const featureRevisionsLoading =
    !featureRevisionsError && !featureRevisionsData;
  const isLoading = revisionsLoading && featureRevisionsLoading;

  const rows: ApprovalRow[] = useMemo(() => {
    const all: ApprovalRow[] = [
      ...revisions.map(revisionToRow),
      ...(featureRevisionsData?.revisions || [])
        .map(featureRevisionToRow)
        .filter((r): r is ApprovalRow => r !== null),
    ];
    return all;
  }, [revisions, featureRevisionsData]);

  const entityTypes = useMemo(() => {
    const types = new Set(rows.map((r) => r.entityType));
    return Array.from(types);
  }, [rows]);

  const authors = useMemo(() => {
    const authorSet = new Set(rows.map((r) => r.authorId));
    return Array.from(authorSet).filter(Boolean);
  }, [rows]);

  const approvalItems = useAddComputedFields(rows, (item) => ({
    ...item,
    authorDisplay: item.authorDisplay || getUserDisplay(item.authorId) || "",
  }));

  const { items, searchInputProps, SortableTH, syntaxFilters, setSearchValue } =
    useSearch({
      items: approvalItems,
      localStorageKey: "approvalRequestsList",
      defaultSortField: "dateCreated",
      defaultSortDir: -1,
      searchFields: ["entityName", "authorId", "title", "authorDisplay"],
      searchTermFilters: {
        status: (item) => item.status,
        type: (item) => item.entityType,
        author: (item) => [item.authorId, item.authorDisplay],
      },
    });

  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });

  // Default to showing only actionable statuses
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (!defaultApplied.current && !router.query.q) {
      setSearchValue("status:draft,pending-review,approved,changes-requested");
      defaultApplied.current = true;
    }
  }, [router.query.q, setSearchValue]);

  // Derive the server-side status filter from the parsed search filters so
  // changes from FilterDropdown / typing in the search box trigger a refetch.
  // - No status filter → default to "open" (bounded, default inbox view).
  // - Negated status filter → fetch all (server can't easily express NOT-in;
  //   the client filter still narrows the view).
  // - Otherwise → join the explicit status values for the server.
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

  if (!hasFeature) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="info">
          Approval flows require an Enterprise plan.
        </Callout>
      </div>
    );
  }

  if (isLoading) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid pagecontents">
      <Box mb="5">
        <Heading as="h1" size="large" mb="2">
          Approval Requests
        </Heading>
        <Text color="text-low">
          Review changes across your organization that require approval.
        </Text>
      </Box>

      {/* Filters */}
      <Flex gap="4" align="start" justify="between" mb="4" wrap="wrap">
        <Box style={{ flexBasis: 300, flexShrink: 0 }}>
          <Field placeholder="Search..." type="search" {...searchInputProps} />
        </Box>
        <Flex gap="5" align="center">
          <FilterDropdown
            filter="type"
            heading="Type"
            syntaxFilters={syntaxFilters}
            open={dropdownFilterOpen}
            setOpen={setDropdownFilterOpen}
            items={entityTypes.map((t) => ({
              name: getEntityTypeLabel(t),
              id: t,
              searchValue: t,
            }))}
            updateQuery={updateQuery}
          />
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

      {/* Table */}
      {items.length === 0 ? (
        <Callout status="info">No approval requests found.</Callout>
      ) : (
        <>
          <Frame p="0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTH field="title">Revision</SortableTH>
                  <SortableTH field="entityName">Name</SortableTH>
                  <SortableTH field="entityType">Type</SortableTH>
                  <TableColumnHeader>Requested by</TableColumnHeader>
                  <SortableTH field="dateCreated">Date Requested</SortableTH>
                  <TableColumnHeader>Status</TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map((row) => {
                  const displayName = row.authorDisplay || row.authorId;
                  return (
                    <TableRow
                      key={row.id}
                      onClick={() => router.push(row.url)}
                      style={{ cursor: "pointer" }}
                      className="hover-highlight"
                    >
                      <TableCell>
                        {row.title || <Text color="text-low">Untitled</Text>}
                      </TableCell>
                      <TableCell>{row.entityName}</TableCell>
                      <TableCell>
                        {getEntityTypeLabel(row.entityType)}
                      </TableCell>
                      <TableCell>
                        {displayName ? (
                          <Flex align="center" gap="2">
                            <UserAvatar
                              name={displayName}
                              size="sm"
                              variant="soft"
                            />
                            <span>{displayName}</span>
                          </Flex>
                        ) : (
                          "--"
                        )}
                      </TableCell>
                      <TableCell>{datetime(row.dateCreated)}</TableCell>
                      <TableCell>{getStatusBadge(row.status)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Frame>

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
    </div>
  );
};

export default ApprovalRequests;
