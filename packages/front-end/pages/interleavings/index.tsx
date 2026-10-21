import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Box, Flex } from "@radix-ui/themes";
import type { ApiInterleavingInterface } from "shared/validators";
import { date, datetime } from "shared/dates";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { tagFilterOnClick, useSearch } from "@/services/search";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useURLHash from "@/hooks/useURLHash";
import { useInterleavings } from "@/hooks/useInterleavings";
import Field from "@/components/Forms/Field";
import SortedTags from "@/components/Tags/SortedTags";
import EmptyState from "@/components/EmptyState";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import LinkButton from "@/ui/LinkButton";
import Pagination from "@/ui/Pagination";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import InterleavingForm from "@/enterprise/components/Interleaving/InterleavingForm";

const LIST_TABS = ["all", "running", "drafts", "stopped", "archived"] as const;
type ListTab = (typeof LIST_TABS)[number];
const STATUS_TABS = ["running", "drafts", "stopped", "archived"] as const;
const NUM_PER_PAGE = 20;

function tabOf(il: ApiInterleavingInterface): Exclude<ListTab, "all"> {
  if (il.archived) return "archived";
  return il.status === "draft" ? "drafts" : il.status;
}

const DATE_LABELS: Record<Exclude<ListTab, "all">, string> = {
  running: "started",
  drafts: "created",
  stopped: "ended",
  archived: "updated",
};

const InterleavingsPage = (): React.ReactElement => {
  const { ready, project, getProjectById, getDatasourceById } =
    useDefinitions();
  const { hasCommercialFeature, getOwnerDisplay } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { interleavings, loading, error } = useInterleavings(project);
  const [openNewModal, setOpenNewModal] = useState(false);
  const [urlTab, setTab] = useURLHash<ListTab>([...LIST_TABS]);
  const activeTab: ListTab = LIST_TABS.find((t) => t === urlTab) ?? "all";
  const [currentPage, setCurrentPage] = useState(1);

  const rows = useMemo(
    () =>
      interleavings.map((il) => {
        const tab = tabOf(il);
        return {
          ...il,
          tab,
          date:
            (tab === "running"
              ? il.dateStarted
              : tab === "stopped"
                ? il.dateStopped
                : tab === "archived"
                  ? il.dateUpdated
                  : il.dateCreated) ?? il.dateCreated,
          ownerName: getOwnerDisplay(il.owner),
          projectName: il.project
            ? (getProjectById(il.project)?.name ?? il.project)
            : "",
          datasourceName:
            getDatasourceById(il.datasource)?.name ?? il.datasource,
        };
      }),
    [interleavings, getOwnerDisplay, getProjectById, getDatasourceById],
  );

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    setSearchValue,
  } = useSearch({
    items: rows,
    searchFields: ["name^3", "key", "trackingKey", "tags", "ownerName"],
    localStorageKey: "interleavings-page",
    defaultSortField: "date",
    defaultSortDir: -1,
  });

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.tab] = (counts[item.tab] || 0) + 1;
    });
    return counts;
  }, [items]);

  const filtered = useMemo(
    () =>
      activeTab === "all"
        ? items.filter((item) => item.tab !== "archived")
        : items.filter((item) => item.tab === activeTab),
    [activeTab, items],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

  if (!hasCommercialFeature("interleaving")) {
    return (
      <Box className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1="Interleaving Experiments"
          title="Compare two rankers head-to-head with Interleaving"
          description="Interleaving merges two ranked lists for each user and measures which ranker's items get engagement, detecting ranking differences with far less traffic than an A/B test."
          commercialFeature="interleaving"
          learnMoreLink="https://docs.growthbook.io"
        />
      </Box>
    );
  }
  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const canAdd = permissionsUtil.canCreateInterleaving({ project });
  const hasInterleavings = interleavings.length > 0;
  const showProjectColumn = !project && filtered.some((il) => il.project);
  const colSpan = 6 + (showProjectColumn ? 1 : 0);
  const start = (currentPage - 1) * NUM_PER_PAGE;

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="my-3">
          <div className="filters md-form row align-items-center">
            <div className="col-auto">
              <h1>Interleaving Experiments</h1>
            </div>
            <div style={{ flex: 1 }} />
            {hasInterleavings && (
              <div className="col-auto">
                <Button
                  onClick={() => setOpenNewModal(true)}
                  disabled={!canAdd}
                >
                  Add Interleaving Experiment
                </Button>
              </div>
            )}
          </div>
          {!hasInterleavings ? (
            <EmptyState
              title="Create Your First Interleaving Experiment"
              description="Compare two rankers by interleaving their lists for each user and measuring which ranker's items get engagement."
              leftButton={
                <LinkButton
                  href="https://docs.growthbook.io"
                  variant="outline"
                  external
                >
                  View docs
                </LinkButton>
              }
              rightButton={
                <Tooltip
                  body="You don't have permission to create interleaving experiments in this project."
                  shouldDisplay={!canAdd}
                >
                  <Button
                    disabled={!canAdd}
                    onClick={() => setOpenNewModal(true)}
                  >
                    Create Interleaving Experiment
                  </Button>
                </Tooltip>
              }
            />
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                const tab = LIST_TABS.find((t) => t === value);
                if (tab) setTab(tab);
              }}
            >
              <Box mb="3">
                <TabsList>
                  <TabsTrigger value="all">All Interleaving</TabsTrigger>
                  {STATUS_TABS.map((tabValue) => {
                    if (tabValue === "archived" && !tabCounts.archived) {
                      return null;
                    }
                    return (
                      <TabsTrigger value={tabValue} key={tabValue}>
                        {tabValue.slice(0, 1).toUpperCase()}
                        {tabValue.slice(1)}
                        {tabValue !== "archived" && (
                          <span
                            style={{
                              marginLeft: "var(--space-2)",
                              background: "var(--gray-3)",
                              border: "1px solid var(--gray-6)",
                              borderRadius: "var(--radius-2)",
                              padding: "0 var(--space-2)",
                              fontSize: "var(--font-size-1)",
                              color: "var(--gray-11)",
                            }}
                          >
                            {tabCounts[tabValue] || 0}
                          </span>
                        )}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Box>
              <Flex gap="4" align="center" justify="between" mb="4" wrap="wrap">
                <Box flexBasis="300px" flexShrink="0">
                  <Field
                    placeholder="Search..."
                    type="search"
                    {...searchInputProps}
                  />
                </Box>
              </Flex>
              <Table variant="list" stickyHeader roundedCorners>
                <TableHeader>
                  <TableRow>
                    <SortableTableColumnHeader
                      field="name"
                      style={{ maxWidth: 320 }}
                    >
                      Interleaving Experiment
                    </SortableTableColumnHeader>
                    {showProjectColumn && (
                      <SortableTableColumnHeader field="projectName">
                        Project
                      </SortableTableColumnHeader>
                    )}
                    <SortableTableColumnHeader field="datasourceName">
                      Data Source
                    </SortableTableColumnHeader>
                    <SortableTableColumnHeader field="tags">
                      Tags
                    </SortableTableColumnHeader>
                    <SortableTableColumnHeader field="ownerName">
                      Owner
                    </SortableTableColumnHeader>
                    <SortableTableColumnHeader field="date">
                      Date
                    </SortableTableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(start, start + NUM_PER_PAGE).map((il) => (
                    <TableRow key={il.id}>
                      <TableCell style={{ padding: "var(--space-0)" }}>
                        <Link
                          href={`/interleaving/${il.id}`}
                          style={{
                            display: "block",
                            padding: "var(--space-3)",
                            color: "var(--gray-12)",
                          }}
                        >
                          <div
                            style={{ display: "flex", flexDirection: "column" }}
                          >
                            <span className="testname">{il.name}</span>
                            {isFiltered && il.key !== il.name && (
                              <span
                                className="testid"
                                title="Key"
                                style={{
                                  fontSize: "var(--font-size-1)",
                                  color: "var(--gray-10)",
                                }}
                              >
                                {il.key}
                              </span>
                            )}
                          </div>
                        </Link>
                      </TableCell>
                      {showProjectColumn && (
                        <TableCell>{il.projectName || <em>None</em>}</TableCell>
                      )}
                      <TableCell>{il.datasourceName}</TableCell>
                      <TableCell>
                        <SortedTags
                          tags={il.tags}
                          useFlex={true}
                          onTagClick={tagFilterOnClick(
                            searchInputProps.value,
                            setSearchValue,
                          )}
                        />
                      </TableCell>
                      <TableCell>{il.ownerName || <em>None</em>}</TableCell>
                      <TableCell title={datetime(il.date)}>
                        {DATE_LABELS[il.tab]} {date(il.date)}
                      </TableCell>
                      <TableCell>
                        {il.tab === "archived"
                          ? "Archived"
                          : il.status.slice(0, 1).toUpperCase() +
                            il.status.slice(1)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={colSpan} className="text-center">
                        {isFiltered
                          ? "No interleaving experiments match the current filter."
                          : "No interleaving experiments found."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {filtered.length > NUM_PER_PAGE && (
                <Pagination
                  numItemsTotal={filtered.length}
                  currentPage={currentPage}
                  perPage={NUM_PER_PAGE}
                  onPageChange={setCurrentPage}
                />
              )}
            </Tabs>
          )}
        </div>
      </div>
      {openNewModal && (
        <InterleavingForm onClose={() => setOpenNewModal(false)} />
      )}
    </>
  );
};

export default InterleavingsPage;
