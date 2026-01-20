import React, { useMemo } from "react";
import { Flex, Box, Heading, Text } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import { datetime } from "shared/dates";
import { ApprovalFlowInterface } from "shared/validators";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import UserAvatar from "../Avatar/UserAvatar";
import Field from "@/components/Forms/Field";
import Pagination from "@/components/Pagination";
import { useAddComputedFields, useSearch } from "@/services/search";
import {
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";

interface ApprovalFlowListProps {
  approvalFlows: ApprovalFlowInterface[];
  isLoading?: boolean;
  setApprovalFlow: (flow: ApprovalFlowInterface) => void;
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
    const types = new Set(approvalFlows.map((f) => f.entity.entityType));
    return Array.from(types);
  }, [approvalFlows]);

  // Get unique authors for the filter
  const authors = useMemo(() => {
    const authorSet = new Set(approvalFlows.map((f) => f.author));
    return Array.from(authorSet).filter(Boolean);
  }, [approvalFlows]);

  const getEntityTypeLabel = (entityType: string) => {
    const labels: Record<string, string> = {
      "fact-metric": "Fact Metric",
      "fact-table": "Fact Table",
    };
    return labels[entityType] || entityType;
  };
  const approvalItems = useAddComputedFields(approvalFlows, (item) => ({
    ...item,
    entityType: item.entity.entityType,
  }));

  const { items, searchInputProps, SortableTH, syntaxFilters, setSearchValue } =
    useSearch({
      items: approvalItems,
      localStorageKey: "approvalFlowList",
      defaultSortField: "dateCreated",
      defaultSortDir: -1,
      searchFields: ["title"],
      searchTermFilters: {
        status: (item) => item.status,
        entityType: (item) => item.entity.entityType,
        author: (item) => [item.author, getUserDisplay(item.author)],
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

    let filtered = items;

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

    // Sort by date descending
    open.sort(
      (a, b) =>
        new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
    );
    history.sort(
      (a, b) =>
        new Date(b.mergedAt || b.dateCreated).getTime() -
        new Date(a.mergedAt || a.dateCreated).getTime(),
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

  const getStatusBadge = (status: string) => {
    const badges: Record<
      string,
      { color: "gray" | "yellow" | "green" | "orange" | "purple"; text: string }
    > = {
      draft: { color: "gray", text: "Draft" },
      "pending-review": { color: "yellow", text: "Pending review" },
      approved: { color: "green", text: "Approved" },
      "changes-requested": { color: "orange", text: "Changes requested" },
      merged: { color: "purple", text: "Published" },
      closed: { color: "gray", text: "Closed" },
    };

    const badge = badges[status] || badges.draft;

    return (
      <Badge label={badge.text} color={badge.color} variant="soft" />
    );
  };
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
        <Heading size="4" mb="3">
          Approval Requests
        </Heading>

        {paginatedRequests.length === 0 ? (
          <Text size="2" color="gray">
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
                      {flow.author ? (
                        <Flex align="center" gap="2">
                          <UserAvatar
                            name={getUserDisplay(flow.author)}
                            size="sm"
                            variant="soft"
                          />
                          <span>{getUserDisplay(flow.author)}</span>
                        </Flex>
                      ) : (
                        "--"
                      )}
                    </td>
                    {showEntityType && (
                      <td>{getEntityTypeLabel(flow.entity.entityType)}</td>
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
          <Heading size="4" mb="3">
            History
          </Heading>

          {paginatedHistory.length === 0 ? (
            <Text size="2" color="gray">
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
                      <td>{datetime(flow.mergedAt || flow.dateCreated)}</td>
                      <td>
                        {flow.reviews.length > 0 ? flow.reviews.length : "--"}
                      </td>
                      <td>
                        <Text
                          size="2"
                          color="violet"
                          style={{ cursor: "pointer" }}
                        >
                          Diff summary...
                        </Text>
                      </td>
                      <td>
                        {flow.mergedBy || flow.author ? (
                          <Flex align="center" gap="2">
                            <UserAvatar
                              name={getUserDisplay(
                                flow.mergedBy || flow.author,
                              )}
                              size="sm"
                              variant="soft"
                            />
                            <span>
                              {getUserDisplay(flow.mergedBy || flow.author)}
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
