import { FC, useEffect, useMemo, useRef, useState } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { datetime } from "shared/dates";
import { Revision } from "shared/enterprise";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
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

const ITEMS_PER_PAGE = 10;

function getEntityName(revision: Revision): string {
  if (revision.target.type === "saved-group") {
    return revision.target.snapshot?.groupName || revision.target.id;
  }
  return revision.target.id;
}

function getEntityTypeLabel(entityType: string): string {
  const labels: Record<string, string> = {
    "saved-group": "Saved Group",
  };
  return labels[entityType] || entityType;
}

function getEntityUrl(revision: Revision): string {
  if (revision.target.type === "saved-group") {
    return `/saved-groups/${revision.target.id}`;
  }
  return "#";
}

const ApprovalRequests: FC = () => {
  const router = useRouter();
  const { getUserDisplay, hasCommercialFeature } = useUser();
  const hasFeature = hasCommercialFeature("require-approvals");
  const { revisions, isLoading } = useRevisions();

  const entityTypes = useMemo(() => {
    const types = new Set(revisions.map((f) => f.target.type));
    return Array.from(types);
  }, [revisions]);

  const authors = useMemo(() => {
    const authorSet = new Set(revisions.map((f) => f.authorId));
    return Array.from(authorSet).filter(Boolean);
  }, [revisions]);

  const approvalItems = useAddComputedFields(revisions, (item) => ({
    ...item,
    entityName: getEntityName(item),
    entityType: item.target.type,
  }));

  const { items, searchInputProps, SortableTH, syntaxFilters, setSearchValue } =
    useSearch({
      items: approvalItems,
      localStorageKey: "approvalRequestsList",
      defaultSortField: "dateCreated",
      defaultSortDir: -1,
      searchFields: ["entityName", "authorId"],
      searchTermFilters: {
        status: (item) => item.status,
        type: (item) => item.target.type,
        author: (item) => [item.authorId, getUserDisplay(item.authorId)],
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
      setSearchValue("status:pending-review,approved,changes-requested");
      defaultApplied.current = true;
    }
  }, [router.query.q, setSearchValue]);

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
    { name: "Published", id: "merged", searchValue: "merged" },
    { name: "Closed", id: "closed", searchValue: "closed" },
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
              name: getUserDisplay(a),
              id: a,
              searchValue: getUserDisplay(a),
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
          <table className="table gbtable">
            <thead>
              <tr>
                <SortableTH field="entityName">Name</SortableTH>
                <SortableTH field="entityType">Type</SortableTH>
                <th>Requested by</th>
                <SortableTH field="dateCreated">Date Requested</SortableTH>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((revision) => (
                <tr
                  key={revision.id}
                  onClick={() => router.push(getEntityUrl(revision))}
                  style={{ cursor: "pointer" }}
                  className="hover-highlight"
                >
                  <td>{getEntityName(revision)}</td>
                  <td>{getEntityTypeLabel(revision.target.type)}</td>
                  <td>
                    {revision.authorId ? (
                      <Flex align="center" gap="2">
                        <UserAvatar
                          name={getUserDisplay(revision.authorId)}
                          size="sm"
                          variant="soft"
                        />
                        <span>{getUserDisplay(revision.authorId)}</span>
                      </Flex>
                    ) : (
                      "--"
                    )}
                  </td>
                  <td>{datetime(revision.dateCreated)}</td>
                  <td>{getStatusBadge(revision.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>

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
