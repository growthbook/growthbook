import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import { Box, Flex } from "@radix-ui/themes";
import {
  ComputedContextualBanditInterface,
  contextualBanditStatusIndicatorData,
  useContextualBanditSearch,
} from "@/services/contextualBandits";
import LoadingOverlay from "@/components/LoadingOverlay";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import { tagFilterOnClick, tagLinkProps } from "@/services/search";
import Field from "@/components/Forms/Field";
import Switch from "@/ui/Switch";
import { useContextualBandits } from "@/hooks/useContextualBandits";
import Tooltip from "@/components/Tooltip/Tooltip";
import ContextualBanditSearchFilters from "@/components/Search/ContextualBanditSearchFilters";
import { useWatching } from "@/services/WatchProvider";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import ContextualBanditForm from "@/enterprise/components/ContextualBandit/ContextualBanditForm";
import Button from "@/ui/Button";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import ContextualBanditEmptyState, {
  ContextualBanditEmptyStateKind,
} from "@/components/ContextualBandit/ContextualBanditEmptyState";
import Callout from "@/ui/Callout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import useURLHash from "@/hooks/useURLHash";

const NUM_PER_PAGE = 20;

const CONTEXTUAL_BANDIT_LIST_TABS = [
  "all",
  "running",
  "drafts",
  "stopped",
  "archived",
] as const;
type ContextualBanditListTab = (typeof CONTEXTUAL_BANDIT_LIST_TABS)[number];
const isContextualBanditListTab = (
  value: string,
): value is ContextualBanditListTab =>
  CONTEXTUAL_BANDIT_LIST_TABS.includes(value as ContextualBanditListTab);

const ContextualBanditsPage = (): React.ReactElement => {
  const { ready, project, projects, datasources } = useDefinitions();

  const initialHashRef = useRef(
    globalThis?.window ? window.location.hash.slice(1) : "",
  );
  const hasInitialValidHash = isContextualBanditListTab(initialHashRef.current);
  const [urlTab, setTab] = useURLHash<ContextualBanditListTab>(
    CONTEXTUAL_BANDIT_LIST_TABS,
  );
  const tab: ContextualBanditListTab =
    urlTab && isContextualBanditListTab(urlTab) ? urlTab : "all";
  const [storedTab, setStoredTab] = useLocalStorage<ContextualBanditListTab>(
    "contextual-bandits-list-tab",
    "all",
  );
  const [didInitializeTab, setDidInitializeTab] = useState(false);
  const activeTab: ContextualBanditListTab =
    !hasInitialValidHash && !didInitializeTab ? storedTab : tab;

  useEffect(() => {
    if (didInitializeTab) return;
    if (!hasInitialValidHash && storedTab !== tab) {
      setTab(storedTab);
    }
    setDidInitializeTab(true);
  }, [didInitializeTab, hasInitialValidHash, setTab, storedTab, tab]);

  useEffect(() => {
    if (!didInitializeTab) return;
    if (storedTab !== tab) {
      setStoredTab(tab);
    }
  }, [didInitializeTab, setStoredTab, storedTab, tab]);

  const { contextualBandits, error, loading, hasArchived } =
    useContextualBandits(project, activeTab === "archived");

  const [showMineOnly, setShowMineOnly] = useLocalStorage(
    "showMyContextualBanditsOnly",
    false,
  );
  const [openNewModal, setOpenNewModal] = useState(false);

  const { userId, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [currentPage, setCurrentPage] = useState(1);

  const { watchedExperiments } = useWatching();

  const filterResults = useCallback(
    (items: ComputedContextualBanditInterface[]) => {
      if (showMineOnly) {
        items = items.filter(
          (item) =>
            item.owner === userId || watchedExperiments.includes(item.id),
        );
      }

      return items;
    },
    [showMineOnly, userId, watchedExperiments],
  );

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTH,
    setSearchValue,
    syntaxFilters,
  } = useContextualBanditSearch({
    contextualBandits,
    filterResults,
    localStorageKey: "contextual-bandits-page",
    watchedIds: watchedExperiments,
  });

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.tab] = counts[item.tab] || 0;
      counts[item.tab]++;
    });
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    return activeTab !== "all"
      ? items.filter((item) => item.tab === activeTab)
      : items;
  }, [activeTab, items]);

  const showProjectColumn = !project && items.some((e) => e.project);

  const hasContextualBanditFeature = hasCommercialFeature("contextual-bandits");

  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments = contextualBandits.length > 0;

  const canAdd = permissionsUtil.canViewExperimentModal(project, projects);

  const exposureDataSources = datasources.filter(
    (d) => d.properties?.exposureQueries,
  );
  const hasDataSource = exposureDataSources.length > 0;
  const emptyStateKind: ContextualBanditEmptyStateKind = !hasDataSource
    ? "no-data-source"
    : "ready";

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  if (!hasContextualBanditFeature) {
    return (
      <Box className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1="Contextual Bandits"
          title="Run Context-Aware Adaptive Experiments with Contextual Bandits"
          description="Contextual Bandits automatically guide more traffic to better variants based on user context."
          commercialFeature="contextual-bandits"
          learnMoreLink="https://docs.growthbook.io/bandits/overview"
        />
      </Box>
    );
  }

  return (
    <>
      <Box className="contents experiments container-fluid pagecontents">
        <Box mb="3" mt="2">
          <Flex
            className="filters md-form"
            align="center"
            mb="3"
            gap="3"
            wrap="wrap"
          >
            <Flex align="center" flexGrow="1">
              <h1>Contextual Bandits</h1>
            </Flex>
            {canAdd && hasExperiments && (
              <PremiumTooltip
                tipPosition="left"
                commercialFeature="contextual-bandits"
              >
                <Button
                  onClick={() => {
                    setOpenNewModal(true);
                  }}
                  disabled={!hasContextualBanditFeature}
                >
                  Add Contextual Bandit
                </Button>
              </PremiumTooltip>
            )}
          </Flex>
          <CustomMarkdown page={"experimentList"} />
          {!hasExperiments ? (
            <ContextualBanditEmptyState
              kind={emptyStateKind}
              canAdd={canAdd}
              hasContextualBanditFeature={hasContextualBanditFeature}
              onCreate={() => setOpenNewModal(true)}
            />
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                if (isContextualBanditListTab(value)) {
                  setTab(value);
                }
              }}
            >
              <Box mb="3">
                <TabsList>
                  <TabsTrigger value="all">All Contextual Bandits</TabsTrigger>
                  {(["running", "drafts", "stopped", "archived"] as const).map(
                    (tabValue) => {
                      if (tabValue === "archived" && !hasArchived) return null;
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
                    },
                  )}
                </TabsList>
              </Box>
              <Flex align="center" mb="3" gap="3" wrap="wrap">
                <Box>
                  <Field
                    placeholder="Search..."
                    type="search"
                    {...searchInputProps}
                  />
                </Box>
                <ContextualBanditSearchFilters
                  searchInputProps={searchInputProps}
                  syntaxFilters={syntaxFilters}
                  setSearchValue={setSearchValue}
                  contextualBandits={contextualBandits}
                />
                <Box style={{ marginLeft: "auto" }}>
                  <Switch
                    id="my-contextual-bandits-toggle"
                    label="My Contextual Bandits Only"
                    value={showMineOnly}
                    onChange={(value) => {
                      setShowMineOnly(value);
                    }}
                  />
                </Box>
              </Flex>
              <TabsContent value={activeTab}>
                <table className="appbox table experiment-table gbtable responsive-table">
                  <thead>
                    <tr>
                      <th></th>
                      <SortableTH field="name" className="w-100">
                        Contextual Bandit
                      </SortableTH>
                      {showProjectColumn && (
                        <SortableTH field="projectName">Project</SortableTH>
                      )}
                      <SortableTH field="tags">Tags</SortableTH>
                      <SortableTH field="ownerName">Owner</SortableTH>
                      <SortableTH field="date">Date</SortableTH>
                      <SortableTH field="status">Status</SortableTH>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(start, end).map((e) => {
                      return (
                        <tr key={e.id} className="hover-highlight">
                          <td
                            data-title="Watching status:"
                            className="watching"
                          >
                            <WatchButton
                              item={e.id}
                              itemType="experiment"
                              type="icon"
                            />
                          </td>
                          <td
                            data-title="Contextual Bandit name:"
                            className="p-0"
                          >
                            <Link
                              href={`/contextual-bandit/${e.id}`}
                              style={{
                                display: "block",
                                padding: "0.5rem",
                              }}
                            >
                              <Flex direction="column">
                                <Flex>
                                  <span className="testname">{e.name}</span>
                                </Flex>
                                {isFiltered && e.trackingKey && (
                                  <span
                                    className="testid text-muted small"
                                    title="Experiment Id"
                                  >
                                    {e.trackingKey}
                                  </span>
                                )}
                              </Flex>
                            </Link>
                          </td>
                          {showProjectColumn && (
                            <td className="nowrap" data-title="Project:">
                              {e.projectIsDeReferenced ? (
                                <Tooltip
                                  body={
                                    <>
                                      Project <code>{e.project}</code> not found
                                    </>
                                  }
                                >
                                  <span className="text-danger">
                                    Invalid project
                                  </span>
                                </Tooltip>
                              ) : (
                                (e.projectName ?? <em>None</em>)
                              )}
                            </td>
                          )}

                          <td data-title="Tags:" className="table-tags">
                            <SortedTags
                              tags={Object.values(e.tags)}
                              useFlex={true}
                              {...tagLinkProps("contextual-bandits")}
                              onTagClick={tagFilterOnClick(
                                searchInputProps.value,
                                setSearchValue,
                              )}
                            />
                          </td>
                          <td className="nowrap" data-title="Owner:">
                            {e.ownerName}
                          </td>
                          <td className="nowrap" title={datetime(e.date)}>
                            {e.tab === "running"
                              ? "started"
                              : e.tab === "drafts"
                                ? "created"
                                : e.tab === "stopped"
                                  ? "ended"
                                  : e.tab === "archived"
                                    ? "updated"
                                    : ""}{" "}
                            {date(e.date)}
                          </td>
                          <td className="nowrap" data-title="Status:">
                            <ExperimentStatusIndicator
                              experimentData={contextualBanditStatusIndicatorData(
                                e,
                              )}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length > NUM_PER_PAGE && (
                  <Pagination
                    numItemsTotal={filtered.length}
                    currentPage={currentPage}
                    perPage={NUM_PER_PAGE}
                    onPageChange={setCurrentPage}
                  />
                )}
              </TabsContent>
            </Tabs>
          )}
        </Box>
      </Box>
      {openNewModal && (
        <ContextualBanditForm
          onClose={() => setOpenNewModal(false)}
          source="contextual-bandits-list"
          isNewExperiment={true}
        />
      )}
    </>
  );
};

export default ContextualBanditsPage;
