import React, { useMemo } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { datetime } from "shared/dates";
import { ApprovalFlow } from "shared/enterprise";
import Heading from "@/ui/Heading";
import { getStatusBadge } from "@/components/ApprovalFlow/approvalFlowUtils";
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

interface ApprovalFlowListProps {
  approvalFlows: ApprovalFlow[];
  isLoading?: boolean;
  setApprovalFlow: (flow: ApprovalFlow) => void;
  showEntityType?: boolean;
  showHistory?: boolean;
}

const ITEMS_PER_PAGE = 7;

const ApprovalFlowList: React.FC<ApprovalFlowListProps> = ({
  approvalFlows,
  isLoading = false,
  setApprovalFlow,
  showEntityType = false,
  showHistory = true,
}) => {
  const { getUserDisplay } = useUser();

  // Get unique entity types for the filter
  const entityTypes = useMemo(() => {
    const types = new Set(approvalFlows.map((f) => f.target.type));
    return Array.from(types);
  }, [approvalFlows]);

  // Get unique authors for the filter
  const authors = useMemo(() => {
    const authorSet = new Set(approvalFlows.map((f) => f.authorId));
    return Array.from(authorSet).filter(Boolean);
  }, [approvalFlows]);

  const getEntityTypeLabel = (entityType: string) => {
    const labels: Record<"fact-metric" | "saved-group", string> = {
      "fact-metric": "Fact Metric",
      "saved-group": "Saved Group",
    };
    return labels[entityType as "fact-metric" | "saved-group"] || entityType;
  };
  const approvalItems = useAddComputedFields(approvalFlows, (item) => ({
    ...item,
    entityType: item.target.type,
  }));

  const { items, searchInputProps, SortableTH, syntaxFilters, setSearchValue } =
    useSearch({
      items: approvalItems,
      localStorageKey: "approvalFlowList",
      defaultSortField: "dateCreated",
      defaultSortDir: -1,
      searchFields: ["authorId"],
      searchTermFilters: {
        status: (item) => item.status,
        entityType: (item) => item.target.type,
        author: (item) => [item.authorId, getUserDisplay(item.authorId)],
      },
    });

  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });

  // Split into requests (open) and history (merged)
  const { openFlows, historyFlows } = useMemo(() => {
    // Get status filter from syntax filters
    const statusFilter = syntaxFilters.find((f) => f.field === "status");
    const statusValues = statusFilter?.values || [];

    const filtered = items;

    // Split by status
    const open = filtered.filter((f) => {
      if (statusValues.length > 0) {
        // If status filter is active, check if this status is selected
        if (statusValues.includes("open")) {
          return !["merged", "closed"].includes(f.status);
        }
        if (statusValues.includes("merged")) {
          return f.status === "merged";
        }
        if (statusValues.includes("closed")) {
          return f.status === "closed";
        }
        return statusValues.includes(f.status);
      }
      // Default: show open flows
      return !["merged", "closed"].includes(f.status);
    });

    const history = filtered.filter((f) => f.status === "merged");

    history.sort(
      (a, b) =>
        new Date(b.resolution?.dateCreated || b.dateCreated).getTime() -
        new Date(a.resolution?.dateCreated || a.dateCreated).getTime(),
    );

    return { openFlows: open, historyFlows: history };
  }, [items, syntaxFilters]);

  const [requestsPage, setRequestsPage] = React.useState(1);
  const [historyPage, setHistoryPage] = React.useState(1);

  const paginatedRequests = useMemo(() => {
    const start = (requestsPage - 1) * ITEMS_PER_PAGE;
    return openFlows.slice(start, start + ITEMS_PER_PAGE);
  }, [openFlows, requestsPage]);

  const paginatedHistory = useMemo(() => {
    const start = (historyPage - 1) * ITEMS_PER_PAGE;
    return historyFlows.slice(start, start + ITEMS_PER_PAGE);
  }, [historyFlows, historyPage]);

  const approvalFlowStatusItems = [
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
  ];

  if (isLoading) {
    return <LoadingOverlay />;
  }

  if (!approvalFlows || approvalFlows.length === 0) {
    return (
      <Callout status="info">No approval flows found for this entity</Callout>
    );
  }

  return (
    <Box>
      {/* Filters - matching experiments page style */}
      <Flex gap="4" align="start" justify="between" mb="4" wrap="wrap">
        <Box style={{ flexBasis: 300, flexShrink: 0 }}>
          <Field placeholder="Search" type="search" {...searchInputProps} />
        </Box>
        <Flex gap="5" align="center">
          {showEntityType && (
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
          )}
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
            items={approvalFlowStatusItems}
            updateQuery={updateQuery}
          />
        </Flex>
      </Flex>

      {/* Approval Requests Section */}
      <Box mb="6">
        <Heading size="medium" as="h4" mb="3">
          Approval Requests
        </Heading>

        {paginatedRequests.length === 0 ? (
          <Text size="medium" color="text-low">
            No approval requests found.
          </Text>
        ) : (
          <>
            <table className="table gbtable">
              <thead>
                <tr>
                  <SortableTH field="dateCreated">Date</SortableTH>
                  <th>Comments</th>
                  <th>Requested by</th>
                  {showEntityType && (
                    <SortableTH field="entityType">Type</SortableTH>
                  )}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRequests.map((flow) => (
                  <tr
                    key={flow.id}
                    onClick={() => setApprovalFlow(flow)}
                    style={{ cursor: "pointer" }}
                    className="hover-highlight"
                  >
                    <td>{datetime(flow.dateCreated)}</td>
                    <td>{flow.reviews.length}</td>
                    <td>
                      {flow.authorId ? (
                        <Flex align="center" gap="2">
                          <UserAvatar
                            name={getUserDisplay(flow.authorId)}
                            size="sm"
                            variant="soft"
                          />
                          <span>{getUserDisplay(flow.authorId)}</span>
                        </Flex>
                      ) : (
                        "--"
                      )}
                    </td>
                    {showEntityType && (
                      <td>{getEntityTypeLabel(flow.target.type)}</td>
                    )}
                    <td>{getStatusBadge(flow.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {openFlows.length > ITEMS_PER_PAGE && (
              <Pagination
                numItemsTotal={openFlows.length}
                perPage={ITEMS_PER_PAGE}
                currentPage={requestsPage}
                onPageChange={setRequestsPage}
              />
            )}
          </>
        )}
      </Box>

      {/* History Section */}
      {showHistory && (
        <Box>
          <Heading size="medium" as="h4" mb="3">
            History
          </Heading>

          {paginatedHistory.length === 0 ? (
            <Text size="medium" color="text-low">
              No history found.
            </Text>
          ) : (
            <>
              <table className="table gbtable">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Comments</th>
                    <th>Details</th>
                    <th>Changed by</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedHistory.map((flow) => (
                    <tr
                      key={flow.id}
                      onClick={() => setApprovalFlow(flow)}
                      style={{ cursor: "pointer" }}
                      className="hover-highlight"
                    >
                      <td>
                        {datetime(
                          flow.resolution?.dateCreated || flow.dateCreated,
                        )}
                      </td>
                      <td>
                        {flow.reviews.length > 0 ? flow.reviews.length : "--"}
                      </td>
                      <td>
                        <span
                          style={{
                            cursor: "pointer",
                            color: "var(--violet-9)",
                          }}
                        >
                          Diff summary...
                        </span>
                      </td>
                      <td>
                        {flow.resolution?.userId || flow.authorId ? (
                          <Flex align="center" gap="2">
                            <UserAvatar
                              name={getUserDisplay(
                                flow.resolution?.userId || flow.authorId,
                              )}
                              size="sm"
                              variant="soft"
                            />
                            <span>
                              {getUserDisplay(
                                flow.resolution?.userId || flow.authorId,
                              )}
                            </span>
                          </Flex>
                        ) : (
                          "--"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {historyFlows.length > ITEMS_PER_PAGE && (
                <Pagination
                  numItemsTotal={historyFlows.length}
                  perPage={ITEMS_PER_PAGE}
                  currentPage={historyPage}
                  onPageChange={setHistoryPage}
                />
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
};

export default ApprovalFlowList;
