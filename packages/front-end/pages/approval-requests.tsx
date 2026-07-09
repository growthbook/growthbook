import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex, TextField } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { datetime } from "shared/dates";
import { Revision, RevisionStatus, getRevisionKey } from "shared/enterprise";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { FeatureMetaInfo } from "shared/types/feature";
import Link from "next/link";
import { FaSearch } from "react-icons/fa";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import Owner from "@/components/Avatar/Owner";
import Pagination from "@/ui/Pagination";
import { DocLink } from "@/components/DocLink";
import {
  SyntaxFilter,
  useAddComputedFields,
  useSearch,
} from "@/services/search";
import {
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { buildSavedGroupRevisionUrl } from "@/components/Revision/revisionUtils";
import { useRevisions } from "@/hooks/useRevisions";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";

const ITEMS_PER_PAGE = 20;

// Statuses shown by default when the user hasn't typed or picked any status
// filter. Kept off the visible search input so the placeholder is shown until
// the user actively changes the filter.
const DEFAULT_STATUSES: RevisionStatus[] = [
  "pending-review",
  "approved",
  "changes-requested",
];

// Per design, the default view should lead with items that are blocking
// reviewers, then items where the requestor still has work to do. Lower
// numbers sort to the top. Statuses that are only shown when the user opts
// into them (Draft, Published, Discarded) rank below all actionable items so
// that if they are surfaced they do not push actionable items down.
const STATUS_PRIORITY: Record<RevisionStatus, number> = {
  "pending-review": 0,
  "changes-requested": 1,
  approved: 2,
  draft: 3,
  merged: 4,
  discarded: 5,
};

type FeatureRevisionWithMeta = FeatureRevisionInterface & {
  featureMeta?: FeatureMetaInfo;
};

// Unified row shape so saved-group revisions and feature revisions can be
// listed/filtered/sorted together.
type ApprovalRow = {
  id: string;
  // Custom, user-authored revision title (e.g. "Fix checkout bug"). Empty if
  // the requester didn't set one — in that case the table cell falls back to
  // the "Revision N" label built from `version`.
  title: string;
  // Numeric revision version. Used both to build the "Revision N" fallback
  // label shown in the Revision column and to sort the column consistently
  // when no custom title is set.
  version: number;
  entityName: string;
  entityType: string;
  authorId: string;
  authorDisplay: string;
  status: RevisionStatus;
  // Store as a numeric timestamp (ms) so useSearch's sort comparator (which
  // only understands numbers/strings/arrays) can properly order rows by date.
  dateCreated: number;
  url: string;
  // Projects the underlying entity belongs to. Features have exactly one
  // project (empty string → "no project"); saved groups can belong to many
  // or none. Used by the "Needs my review" scope to check per-project
  // review/edit permissions without having to refetch the entities.
  projects: string[];
};

type ScopeValue = "needs-my-review" | "my-requests" | "all";

function getEntityTypeLabel(entityType: string): string {
  const labels: Record<string, string> = {
    "saved-group": "Saved Group",
    constant: "Constant",
    feature: "Feature",
  };
  return labels[entityType] || entityType;
}

// Dot + text rendering per design. Each actionable status is paired with a
// colored dot; "Draft" is rendered as plain text and "Discarded" as italic
// muted text since those rows are "nice to know" and should visually recede.
// Colors reference Radix CSS variables so they track the active theme.
const STATUS_DOT_COLOR: Partial<Record<RevisionStatus, string>> = {
  "pending-review": "var(--red-9)",
  "changes-requested": "var(--amber-9)",
  approved: "var(--gray-12)",
  merged: "var(--grass-9)",
};

const STATUS_LABEL: Record<RevisionStatus, string> = {
  "pending-review": "Pending review",
  "changes-requested": "Changes requested",
  approved: "Approved",
  merged: "Published",
  draft: "Draft",
  discarded: "Discarded",
};

function StatusDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 8,
        backgroundColor: color,
        flexShrink: 0,
      }}
    />
  );
}

function renderApprovalStatus(status: RevisionStatus) {
  const label = STATUS_LABEL[status] ?? status;
  if (status === "discarded") {
    return (
      <span style={{ fontStyle: "italic", color: "var(--gray-10)" }}>
        {label}
      </span>
    );
  }
  const dot = STATUS_DOT_COLOR[status];
  if (!dot) {
    return <span>{label}</span>;
  }
  return (
    <Flex gap="2" align="center">
      <StatusDot color={dot} />
      {label}
    </Flex>
  );
}

function revisionToRow(revision: Revision): ApprovalRow {
  const entityName =
    revision.target.type === "saved-group"
      ? revision.target.snapshot?.groupName || revision.target.id
      : revision.target.id;

  const projects =
    revision.target.type === "saved-group"
      ? (revision.target.snapshot?.projects ?? [])
      : [];

  return {
    id: revision.id,
    title: revision.title || "",
    version: revision.version ?? 0,
    entityName,
    entityType: revision.target.type,
    authorId: revision.authorId,
    authorDisplay: "",
    status: revision.status,
    dateCreated: new Date(revision.dateCreated).getTime(),
    url: buildRevisionUrl(revision),
    projects,
  };
}

// Build the detail-page URL for a revision based on its entity type. The
// revision key doubles as the route segment (saved-group → /saved-groups,
// constant → /constants).
function buildRevisionUrl(revision: Revision): string {
  if (revision.target.type === "saved-group") {
    return buildSavedGroupRevisionUrl(revision.target.id, revision);
  }
  const key = getRevisionKey(revision.target.type);
  const base = `/${key ?? revision.target.type}/${revision.target.id}`;
  return (revision.version ?? null) !== null
    ? `${base}?v=${revision.version}`
    : base;
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

  // `pending-parent` revisions are held child revisions managed by ramp
  // schedules and are not user-actionable, so they should not appear in the
  // approvals list. Filtering here also narrows revision.status to the values
  // representable by the unified RevisionStatus (feature revisions use
  // "published" where unified revisions use "merged").
  if (revision.status === "pending-parent") return null;
  const status: RevisionStatus =
    revision.status === "published" ? "merged" : revision.status;

  const featureProject = revision.featureMeta?.project ?? "";

  return {
    id: `${revision.featureId}-v${revision.version}`,
    title: revision.title || revision.comment || "",
    version: revision.version,
    entityName: revision.featureId,
    entityType: "feature",
    authorId,
    authorDisplay,
    status,
    dateCreated: new Date(revision.dateCreated).getTime(),
    url: `/features/${revision.featureId}?v=${revision.version}`,
    projects: [featureProject],
  };
}

const ApprovalRequests: FC = () => {
  const router = useRouter();
  const { getUserDisplay, hasCommercialFeature, userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const hasFeature = hasCommercialFeature("require-approvals");

  // Scope selector controlling the top-level "who cares about this row?"
  // filter. Intentionally NOT persisted to localStorage — on each
  // navigation the user should land on the actionable inbox rather than
  // whatever view they last used.
  const [scope, setScope] = useState<ScopeValue>("needs-my-review");
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
    // Composite key so the default view sorts by status priority first and
    // then by date-requested (newest first) within each status bucket. The
    // date is subtracted so ascending numeric sort gives newest-first per
    // bucket. Using a large status multiplier guarantees status dominates the
    // sort regardless of timestamp magnitude.
    _sortKey: STATUS_PRIORITY[item.status] * 1e15 - item.dateCreated,
  }));

  const { items, searchInputProps, SortableTH, syntaxFilters, setSearchValue } =
    useSearch({
      items: approvalItems,
      localStorageKey: "approvalRequestsList",
      // Design requirement: filters and sort should reset each time the user
      // navigates to this page so the primary view (blocked, actionable
      // items) is always front-and-center.
      persistSort: false,
      defaultSortField: "_sortKey",
      defaultSortDir: 1,
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

  // Whether the user has explicitly specified a status filter (via the search
  // box or the Status FilterDropdown). When false we apply DEFAULT_STATUSES
  // implicitly without putting anything in the visible search input.
  const hasExplicitStatusFilter = useMemo(
    () => syntaxFilters.some((f) => f.field === "status"),
    [syntaxFilters],
  );

  // Derive the server-side status filter from the parsed search filters so
  // changes from FilterDropdown / typing in the search box trigger a refetch.
  // - No explicit status filter → use DEFAULT_STATUSES (the inbox default).
  // - Negated status filter → fetch all (server can't easily express NOT-in;
  //   the client filter still narrows the view).
  // - Otherwise → join the explicit status values for the server.
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

  // Apply the implicit default-statuses filter on the client too so the
  // visible table matches the server query even though nothing is typed in
  // the search box.
  const statusFilteredItems = useMemo(() => {
    if (hasExplicitStatusFilter) return items;
    const allowed = new Set<string>(DEFAULT_STATUSES);
    return items.filter((item) => allowed.has(item.status));
  }, [items, hasExplicitStatusFilter]);

  // Per-row "can I act on this as a reviewer?" check. Mirrors the rules used
  // elsewhere: `canReview` permission on the feature's project for feature
  // revisions, and "can edit = can review" (canUpdateSavedGroup) for
  // saved-group revisions — matching canUserReviewEntity in
  // shared/src/revisions/helpers.ts.
  const canReviewRow = useCallback(
    (row: ApprovalRow): boolean => {
      if (row.entityType === "feature") {
        return permissionsUtil.canReviewFeatureDrafts({
          project: row.projects[0] ?? "",
        });
      }
      if (row.entityType === "saved-group") {
        return permissionsUtil.canUpdateSavedGroup(
          { projects: row.projects },
          { projects: row.projects },
        );
      }
      return false;
    },
    [permissionsUtil],
  );

  // Scope-level filter applied on top of the status/search filtering.
  // - "needs-my-review": rows I'm allowed to review, that I didn't author,
  //   and that are in an actionable state (pending-review, changes-requested).
  // - "my-requests": rows I authored (any status).
  // - "all": no additional filtering.
  const effectiveItems = useMemo(() => {
    if (scope === "all") return statusFilteredItems;
    if (scope === "my-requests") {
      return statusFilteredItems.filter(
        (row) => !!userId && row.authorId === userId,
      );
    }
    // scope === "needs-my-review"
    return statusFilteredItems.filter(
      (row) =>
        (row.status === "pending-review" ||
          row.status === "changes-requested") &&
        row.authorId !== userId &&
        canReviewRow(row),
    );
  }, [statusFilteredItems, scope, userId, canReviewRow]);

  // For the Status FilterDropdown only: surface the implicit default statuses
  // as a synthetic syntax filter so the dropdown renders them as ticked when
  // no explicit status filter has been set yet. This makes the default state
  // discoverable without putting anything in the visible search box.
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

  // Custom updateQuery for the Status dropdown. When the user toggles a
  // status while no explicit status filter is set, we first materialize the
  // defaults into the search input (minus/plus the clicked value) so the
  // resulting list matches what the ticks in the dropdown implied.
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
      Math.ceil(effectiveItems.length / ITEMS_PER_PAGE),
    );
    if (currentPage > lastPage) setCurrentPage(1);
  }, [effectiveItems.length, currentPage]);

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return effectiveItems.slice(start, start + ITEMS_PER_PAGE);
  }, [effectiveItems, currentPage]);

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

  // Per design, each filter trigger button surfaces the currently-applied
  // value(s) inline (e.g. "Status: Pending review, Changes requested,
  // Approved"), falling back to "Any" when no explicit filter is set. This
  // matches the filter pattern elsewhere in the Figma (Metrics landing etc.).
  const typeHeading = useMemo(() => {
    const f = syntaxFilters.find((s) => s.field === "type");
    if (!f || f.values.length === 0) return "Type: Any";
    return `Type: ${f.values.map(getEntityTypeLabel).join(", ")}`;
  }, [syntaxFilters]);

  const authorHeading = useMemo(() => {
    const f = syntaxFilters.find((s) => s.field === "author");
    if (!f || f.values.length === 0) return "Requested by: Any";
    return `Requested by: ${f.values
      .map((v) => getUserDisplay(v) || v)
      .join(", ")}`;
  }, [syntaxFilters, getUserDisplay]);

  const statusHeading = useMemo(() => {
    const values: string[] = hasExplicitStatusFilter
      ? (syntaxFilters.find((s) => s.field === "status")?.values ?? [])
      : [...DEFAULT_STATUSES];
    if (values.length === 0) return "Status: Any";
    return `Status: ${values
      .map((v) => STATUS_LABEL[v as RevisionStatus] ?? v)
      .join(", ")}`;
  }, [syntaxFilters, hasExplicitStatusFilter]);

  if (!hasFeature) {
    return (
      <Box p="4" pr="7" width="100%" maxWidth="1340px" mx="auto">
        <Callout status="info">
          Approval flows require an Enterprise plan.
        </Callout>
      </Box>
    );
  }

  if (isLoading) {
    return <LoadingOverlay />;
  }

  return (
    <Box p="4" pr="7" width="100%" maxWidth="1340px" mx="auto">
      <Box mb="5">
        <Heading as="h1" size="large" mb="2">
          Approval Requests
        </Heading>
        <Text color="text-low">
          Review changes across your organization that require approval.{" "}
          <DocLink useRadix={false} docSection="publishingAndApprovalFlows">
            View Docs
          </DocLink>
        </Text>
      </Box>

      {/* Scope tabs — primary grouping of the page. Tabs here act as a
          visual segmented control; the actual content is rendered outside
          the Tabs root so switching scopes keeps the same table + filters
          in place (no content remount flash). */}
      <Box mb="4">
        <Tabs value={scope} onValueChange={(v) => setScope(v as ScopeValue)}>
          <TabsList>
            <TabsTrigger value="needs-my-review">Needs a review</TabsTrigger>
            <TabsTrigger value="my-requests">My requests</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </Box>

      {/* Filters */}
      <Flex gap="4" align="start" justify="between" mb="4" wrap="wrap">
        <Box flexBasis="300px" flexShrink="0">
          <TextField.Root
            placeholder="Search..."
            type="search"
            size="2"
            {...searchInputProps}
          >
            <TextField.Slot>
              <FaSearch />
            </TextField.Slot>
          </TextField.Root>
        </Box>
        <Flex gap="5" align="center">
          <FilterDropdown
            filter="type"
            heading={typeHeading}
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
            heading={authorHeading}
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
            heading={statusHeading}
            syntaxFilters={statusDropdownSyntaxFilters}
            open={dropdownFilterOpen}
            setOpen={setDropdownFilterOpen}
            items={statusFilterItems}
            updateQuery={updateStatusQuery}
          />
        </Flex>
      </Flex>

      {/* Table */}
      {effectiveItems.length === 0 ? (
        <Callout status="info">
          {scope === "needs-my-review" ? (
            <>
              No approval requests need a review right now.{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setScope("all");
                }}
              >
                Show all approval requests
              </a>
              .
            </>
          ) : scope === "my-requests" ? (
            "You haven't submitted any approval requests."
          ) : (
            "No approval requests found."
          )}
        </Callout>
      ) : (
        <>
          <table className="table gbtable table-valign-top">
            <thead>
              <tr>
                <SortableTH field="entityName">Name</SortableTH>
                <SortableTH field="version">Revision</SortableTH>
                <SortableTH field="entityType">Type</SortableTH>
                <SortableTH field="authorDisplay">Requested by</SortableTH>
                <SortableTH field="dateCreated">Date Requested</SortableTH>
                <SortableTH field="_sortKey">Status</SortableTH>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((row) => (
                <tr
                  key={row.id}
                  className="hover-highlight"
                  onClick={() => router.push(row.url)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <Link
                      href={row.url}
                      onClick={(e) => e.stopPropagation()}
                      className="link-purple"
                    >
                      {row.entityName}
                    </Link>
                  </td>
                  <td>
                    <Link
                      href={row.url}
                      onClick={(e) => e.stopPropagation()}
                      className="link-purple"
                    >
                      {row.title || `Revision ${row.version}`}
                    </Link>
                  </td>
                  <td>{getEntityTypeLabel(row.entityType)}</td>
                  <td>
                    {row.authorId ? (
                      <Owner ownerId={row.authorId} />
                    ) : (
                      row.authorDisplay || "--"
                    )}
                  </td>
                  <td>{datetime(new Date(row.dateCreated))}</td>
                  <td>{renderApprovalStatus(row.status)}</td>
                </tr>
              ))}
              {paginatedItems.length === 0 && (
                <tr>
                  <td colSpan={6} align="center">
                    No matching approval requests
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {effectiveItems.length > ITEMS_PER_PAGE && (
            <Pagination
              numItemsTotal={effectiveItems.length}
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

export default ApprovalRequests;
