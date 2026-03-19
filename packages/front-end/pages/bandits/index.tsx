import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import clsx from "clsx";
import { PiShuffle } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { ComputedExperimentInterface } from "shared/types/experiment";
import LoadingOverlay from "@/components/LoadingOverlay";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import Switch from "@/ui/Switch";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import { useWatching } from "@/services/WatchProvider";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import Button from "@/ui/Button";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LinkButton from "@/ui/LinkButton";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import Callout from "@/ui/Callout";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { useExperimentSearch } from "@/services/experiments";

const NUM_PER_PAGE = 20;

const ExperimentsPage = (): React.ReactElement => {
  const { ready, project, projects } = useDefinitions();

  const [tabs, setTabs] = useLocalStorage<string[]>("experiment_tabs", []);

  const {
    experiments: allExperiments,
    error,
    loading,
    hasArchived,
  } = useExperiments(project, tabs.includes("archived"), "multi-armed-bandit");

  const tagsFilter = useTagsFilter("experiments");
  const [showMineOnly, setShowMineOnly] = useLocalStorage(
    "showMyExperimentsOnly",
    false,
  );
  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);

  const { userId, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [currentPage, setCurrentPage] = useState(1);

  const { watchedExperiments } = useWatching();

  const filterResults = useCallback(
    (items: ComputedExperimentInterface[]) => {
      if (showMineOnly) {
        items = items.filter(
          (item) =>
            item.owner === userId || watchedExperiments.includes(item.id),
        );
      }

      items = filterByTags(items, tagsFilter.tags);

      return items;
    },
    [showMineOnly, userId, tagsFilter.tags, watchedExperiments],
  );

  const { items, searchInputProps, isFiltered, SortableTableColumnHeader } =
    useExperimentSearch({
      allExperiments,
      filterResults,
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
    return tabs.length
      ? items.filter((item) => tabs.includes(item.tab))
      : items;
  }, [tabs, items]);

  // If "All Projects" is selected is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && items.some((e) => e.project);

  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits",
  );

  // Reset to page 1 when a filter is applied or tabs change
  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

  if (error) {
    return (
      <Callout status="error" mb="3">
        An error occurred: {error.message}
      </Callout>
    );
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments = allExperiments.length > 0;

  const canAdd = permissionsUtil.canViewExperimentModal(project, projects);

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  function onToggleTab(tab: string) {
    return () => {
      const newTabs = new Set(tabs);
      if (newTabs.has(tab)) newTabs.delete(tab);
      else newTabs.add(tab);
      setTabs([...newTabs]);
    };
  }

  if (!hasMultiArmedBanditFeature) {
    return (
      <Box className="contents pagecontents">
        <PremiumEmptyState
          h1="Bandits"
          title="Run Adaptive Experiments with Bandits"
          description="Bandits automatically guide more traffic to better variants."
          commercialFeature="multi-armed-bandits"
          learnMoreLink="https://docs.growthbook.io/bandits/overview"
        />
      </Box>
    );
  }

  return (
    <>
      <Box className="contents pagecontents" mb="3" mt="2">
        <Flex
          className="filters md-form"
          mb="3"
          align="center"
          gap="3"
          wrap="wrap"
        >
          <Flex align="center">
            <h1>Bandits</h1>
          </Flex>
          <Box style={{ flex: 1 }} />
          {canAdd && (
            <Box>
              <PremiumTooltip
                tipPosition="left"
                commercialFeature="multi-armed-bandits"
              >
                <Button
                  onClick={() => {
                    setOpenNewExperimentModal(true);
                  }}
                  disabled={!hasMultiArmedBanditFeature}
                >
                  Add Bandit
                </Button>
              </PremiumTooltip>
            </Box>
          )}
        </Flex>
        <CustomMarkdown page={"experimentList"} />
        {!hasExperiments ? (
          <Box className="box" py="5" style={{ textAlign: "center" }}>
            <Box style={{ maxWidth: 650, margin: "0 auto" }}>
              <h1>Adaptively experiment with bandits.</h1>
              <p className="">Run adaptive experiments with Bandits.</p>
            </Box>
            <Flex justify="center" pt="2" gap="3">
              <LinkButton
                href="/getstarted/experiment-guide"
                variant="outline"
                mr="4"
              >
                Setup Instructions
              </LinkButton>
              {canAdd && (
                <PremiumTooltip
                  tipPosition="left"
                  popperStyle={{ top: 15 }}
                  commercialFeature="multi-armed-bandits"
                >
                  <Button
                    onClick={() => {
                      setOpenNewExperimentModal(true);
                    }}
                    disabled={!hasMultiArmedBanditFeature}
                  >
                    Add Bandit
                  </Button>
                </PremiumTooltip>
              )}
            </Flex>
            <Box mt="5">
              <img
                src="/images/empty-states/bandits.png"
                alt="Bandits"
                style={{ width: "100%", maxWidth: "740px", height: "auto" }}
              />
            </Box>
          </Box>
        ) : (
          <>
            <Flex align="center" mb="3" gap="3" wrap="wrap">
              <Flex gap="2">
                {["running", "drafts", "stopped", "archived"].map((tab, i) => {
                  const active = tabs.includes(tab);

                  if (tab === "archived" && !hasArchived) return null;

                  return (
                    <button
                      key={tab}
                      className={clsx("border mb-0", {
                        "badge-purple font-weight-bold": active,
                        "text-secondary": !active,
                        "rounded-left": i === 0,
                        "rounded-right":
                          tab === "archived" ||
                          (tab === "stopped" && !hasArchived),
                      })}
                      style={{
                        fontSize: "1em",
                        opacity: active ? 1 : 0.8,
                        padding: "6px 12px",
                        backgroundColor: active ? "" : "var(--color-panel)",
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        onToggleTab(tab)();
                      }}
                      title={
                        active && tabs.length > 1
                          ? `Hide ${tab} experiments`
                          : active
                            ? `Remove filter`
                            : tabs.length === 0
                              ? `View only ${tab} experiments`
                              : `Include ${tab} experiments`
                      }
                    >
                      <span className="mr-1">
                        {tab.slice(0, 1).toUpperCase()}
                        {tab.slice(1)}
                      </span>
                      {tab !== "archived" && (
                        <span className="badge bg-white border text-dark mr-2">
                          {tabCounts[tab] || 0}
                        </span>
                      )}
                    </button>
                  );
                })}
              </Flex>
              <Box>
                <Field
                  placeholder="Search..."
                  type="search"
                  {...searchInputProps}
                />
              </Box>
              <Box>
                <TagsFilter filter={tagsFilter} items={items} />
              </Box>
              <Box style={{ marginLeft: "auto" }}>
                <Switch
                  id="my-experiments-toggle"
                  label="My Bandits Only"
                  value={showMineOnly}
                  onChange={(value) => {
                    setShowMineOnly(value);
                  }}
                />
              </Box>
            </Flex>

            <Table
              variant="list"
              stickyHeader
              roundedCorners
              className="responsive-table"
            >
              <TableHeader>
                <TableRow>
                  <TableColumnHeader />
                  <SortableTableColumnHeader field="name" className="w-100">
                    Bandit
                  </SortableTableColumnHeader>
                  {showProjectColumn && (
                    <SortableTableColumnHeader field="projectName">
                      Project
                    </SortableTableColumnHeader>
                  )}
                  <SortableTableColumnHeader field="tags">
                    Tags
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader field="ownerName">
                    Owner
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader field="date">
                    Date
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader field="status">
                    Status
                  </SortableTableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(start, end).map((e) => {
                  return (
                    <TableRow key={e.id} className="hover-highlight">
                      <TableCell
                        data-title="Watching status:"
                        className="watching"
                      >
                        <WatchButton
                          item={e.id}
                          itemType="experiment"
                          type="icon"
                        />
                      </TableCell>
                      <TableCell
                        data-title="Bandit name:"
                        className="p-0"
                        style={{ maxWidth: 320 }}
                      >
                        <Link
                          href={`/bandit/${e.id}`}
                          className="d-block"
                          style={{ padding: "var(--space-3)" }}
                        >
                          <Flex direction="column" gap="1">
                            <Flex align="center" gap="2">
                              <span className="testname">{e.name}</span>
                              {e.hasVisualChangesets ? (
                                <Tooltip
                                  className="d-flex align-items-center ml-2"
                                  body="Visual experiment"
                                >
                                  <RxDesktop className="text-blue" />
                                </Tooltip>
                              ) : null}
                              {(e.linkedFeatures || []).length > 0 ? (
                                <Tooltip
                                  className="d-flex align-items-center ml-2"
                                  body="Linked Feature Flag"
                                >
                                  <BsFlag className="text-blue" />
                                </Tooltip>
                              ) : null}
                              {e.hasURLRedirects ? (
                                <Tooltip
                                  className="d-flex align-items-center ml-2"
                                  body="URL Redirect experiment"
                                >
                                  <PiShuffle className="text-blue" />
                                </Tooltip>
                              ) : null}
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
                      </TableCell>
                      {showProjectColumn && (
                        <TableCell className="nowrap" data-title="Project:">
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
                        </TableCell>
                      )}

                      <TableCell data-title="Tags:" className="table-tags">
                        <SortedTags
                          tags={Object.values(e.tags)}
                          useFlex={true}
                        />
                      </TableCell>
                      <TableCell className="nowrap" data-title="Owner:">
                        {e.ownerName}
                      </TableCell>
                      <TableCell className="nowrap" title={datetime(e.date)}>
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
                      </TableCell>
                      <TableCell className="nowrap" data-title="Status:">
                        <ExperimentStatusIndicator experimentData={e} />
                      </TableCell>
                    </TableRow>
                  );
                })}
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
          </>
        )}
      </Box>
      {openNewExperimentModal && (
        <NewExperimentForm
          onClose={() => setOpenNewExperimentModal(false)}
          source="bandits-list"
          isNewExperiment={true}
          initialValue={{
            type: "multi-armed-bandit",
            statsEngine: "bayesian",
          }}
        />
      )}
    </>
  );
};

export default ExperimentsPage;
