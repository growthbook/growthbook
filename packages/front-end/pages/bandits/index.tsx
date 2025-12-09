import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import clsx from "clsx";
import { PiShuffle } from "react-icons/pi";
import { ComputedExperimentInterface } from "back-end/types/experiment";
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
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LinkButton from "@/ui/LinkButton";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import { useExperimentSearch } from "@/services/experiments";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

const NUM_PER_PAGE = 20;

const ExperimentsPage = (): React.ReactElement => {
  const { ready, project } = useDefinitions();

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
  const settings = useOrgSettings();

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

  const { items, searchInputProps, isFiltered, SortableTH } =
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

  const orgStickyBucketing = !!settings.useStickyBucketing;
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");
  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits",
  );

  // Reset to page 1 when a filter is applied or tabs change
  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments = allExperiments.length > 0;

  const canAdd = permissionsUtil.canViewExperimentModal(project);

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
      <div className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1="Bandits"
          title="Run Adaptive Experiments with Bandits"
          description="Bandits automatically guide more traffic to better variants."
          commercialFeature="multi-armed-bandits"
          learnMoreLink="https://docs.growthbook.io/bandits/overview"
        />
      </div>
    );
  }

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-3 mt-2">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col d-flex align-items-center">
              <h1>Bandits</h1>
            </div>
            <div style={{ flex: 1 }} />
            {canAdd && (
              <div className="col-auto">
                <PremiumTooltip
                  tipPosition="left"
                  body={
                    hasStickyBucketFeature && !orgStickyBucketing
                      ? "Enable Sticky Bucketing in your organization settings to run a Bandit"
                      : undefined
                  }
                  commercialFeature="multi-armed-bandits"
                >
                  <Button
                    onClick={() => {
                      setOpenNewExperimentModal(true);
                    }}
                    disabled={
                      !hasMultiArmedBanditFeature ||
                      !hasStickyBucketFeature ||
                      !orgStickyBucketing
                    }
                  >
                    Add Bandit
                  </Button>
                </PremiumTooltip>
              </div>
            )}
          </div>
          <CustomMarkdown page={"experimentList"} />
          {!hasExperiments ? (
            <div className="box py-5 text-center">
              <div className="mx-auto" style={{ maxWidth: 650 }}>
                <h1>Adaptively experiment with bandits.</h1>
                <p className="">Run adaptive experiments with Bandits.</p>
              </div>
              <div className="d-flex justify-content-center pt-2">
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
                    body={
                      hasStickyBucketFeature && !orgStickyBucketing
                        ? "Enable Sticky Bucketing in your organization settings to run a Bandit"
                        : undefined
                    }
                    commercialFeature="multi-armed-bandits"
                  >
                    <Button
                      onClick={() => {
                        setOpenNewExperimentModal(true);
                      }}
                      disabled={
                        !hasMultiArmedBanditFeature ||
                        !hasStickyBucketFeature ||
                        !orgStickyBucketing
                      }
                    >
                      Add Bandit
                    </Button>
                  </PremiumTooltip>
                )}
              </div>
              <div className="mt-5">
                <img
                  src="/images/empty-states/bandits.png"
                  alt="Bandits"
                  style={{ width: "100%", maxWidth: "740px", height: "auto" }}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="row align-items-center mb-3">
                <div className="col-auto d-flex">
                  {["running", "drafts", "stopped", "archived"].map(
                    (tab, i) => {
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
                    },
                  )}
                </div>
                <div className="col-auto">
                  <Field
                    placeholder="Search..."
                    type="search"
                    {...searchInputProps}
                  />
                </div>
                <div className="col-auto">
                  <TagsFilter filter={tagsFilter} items={items} />
                </div>
                <div className="col-auto ml-auto">
                  <Switch
                    id="my-experiments-toggle"
                    label="My Bandits Only"
                    value={showMineOnly}
                    onChange={(value) => {
                      setShowMineOnly(value);
                    }}
                  />
                </div>
              </div>

              <Table className="appbox experiment-table responsive-table">
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader></TableColumnHeader>
                    <SortableTH field="name" className="w-100">
                      Bandit
                    </SortableTH>
                    {showProjectColumn && (
                      <SortableTH field="projectName">Project</SortableTH>
                    )}
                    <SortableTH field="tags">Tags</SortableTH>
                    <SortableTH field="ownerName">Owner</SortableTH>
                    <SortableTH field="date">Date</SortableTH>
                    <SortableTH field="status">Status</SortableTH>
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
                        <TableCell data-title="Bandit name:" className="p-0">
                          <Link
                            href={`/bandit/${e.id}`}
                            className="d-block p-2"
                          >
                            <div className="d-flex flex-column">
                              <div className="d-flex">
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
                              </div>
                              {isFiltered && e.trackingKey && (
                                <span
                                  className="testid text-muted small"
                                  title="Experiment Id"
                                >
                                  {e.trackingKey}
                                </span>
                              )}
                            </div>
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
        </div>
      </div>
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
