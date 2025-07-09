import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import clsx from "clsx";
import { PiShuffle } from "react-icons/pi";
import {
  ComputedExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import LoadingOverlay from "@/components/LoadingOverlay";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/components/Radix/Button";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LinkButton from "@/components/Radix/LinkButton";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import NewHoldoutForm from "@/components/Holdout/NewHoldoutForm";
import { useAddComputedFields, useSearch } from "@/services/search";

const NUM_PER_PAGE = 20;

const HoldoutsPage = (): React.ReactElement => {
  const { ready, project } = useDefinitions();

  const [tabs, setTabs] = useLocalStorage<string[]>("experiment_tabs", []);

  const {
    experiments: allExperiments,
    error,
    loading,
    hasArchived,
    holdouts,
    experimentsMap,
  } = useExperiments(project, tabs.includes("archived"), "holdout");

  const tagsFilter = useTagsFilter("experiments");

  const [openNewHoldoutModal, setOpenNewHoldoutModal] = useState(false);

  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [currentPage, setCurrentPage] = useState(1);

  const holdoutsWithExperiment = useMemo(() => {
    return holdouts.map((holdout) => ({
      ...holdout,
      experiment: experimentsMap.get(
        holdout.experimentId
      ) as ExperimentInterfaceStringDates,
    }));
  }, [holdouts, experimentsMap]);

  const holdoutItems = useAddComputedFields(holdoutsWithExperiment, (item) => {
    // If draft, set duration to --
    // if running, set duration to start date to now
    // if stopped, set duration to start date to end date
    const durationString =
      item.experiment?.status === "draft"
        ? "--"
        : item.experiment?.status === "running"
        ? `${date(item.experiment.phases[0].dateStarted ?? "")} - now`
        : item.experiment?.status === "stopped"
        ? `${date(item.experiment.phases[0].dateStarted ?? "")} - ${date(
            item.experiment.phases[0].dateEnded ?? ""
          )}`
        : null;

    return {
      name: item.name,
      projects: item.projects,
      tags: item.experiment?.tags,
      duration: durationString,
      numExperiments: item.linkedExperiments.length,
      numFeatures: item.linkedFeatures.length,
      // owner: item.experiment.owner,
      hashAttribute: item.experiment?.hashAttribute,
      status: item.experiment?.status,
    };
  });

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: holdoutItems,
    searchFields: [
      "name",
      "projects",
      "tags",
      "owner",
      "hashAttribute",
      "status",
    ],
    localStorageKey: "holdout-search",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
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

  const hasHoldoutFeature = hasCommercialFeature("holdouts");

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

  const hasHoldouts = allExperiments.length > 0;

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

  if (!hasHoldoutFeature) {
    return (
      <div className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1="Holdouts"
          title="Measure aggregate impact with Holdouts"
          description="Holdouts allow you to measure the aggregate impact of features and experiments."
          commercialFeature="holdouts"
          // learnMoreLink="https://docs.growthbook.io/bandits/overview"
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
              <h1>Holdouts</h1>
            </div>
            <div style={{ flex: 1 }} />
            {canAdd && (
              <div className="col-auto">
                <PremiumTooltip tipPosition="left" commercialFeature="holdouts">
                  <Button
                    onClick={() => {
                      setOpenNewHoldoutModal(true);
                    }}
                    disabled={!hasHoldoutFeature}
                  >
                    Add Holdout
                  </Button>
                </PremiumTooltip>
              </div>
            )}
          </div>
          {!hasHoldouts ? (
            <div className="box py-5 text-center">
              <div className="mx-auto" style={{ maxWidth: 650 }}>
                <h1>Measure aggregate impact with Holdouts</h1>
                <p className="">
                  Measure the aggregate impact of features and experiments with
                  Holdouts.
                </p>
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
                    commercialFeature="holdouts"
                  >
                    <Button
                      onClick={() => {
                        setOpenNewHoldoutModal(true);
                      }}
                      disabled={!hasHoldoutFeature}
                    >
                      Add Holdout
                    </Button>
                  </PremiumTooltip>
                )}
              </div>
              <div className="mt-5">
                {/* TODO: Add holdouts empty state image */}
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
                              ? `Hide ${tab} holdouts`
                              : active
                              ? `Remove filter`
                              : tabs.length === 0
                              ? `View only ${tab} holdouts`
                              : `Include ${tab} holdouts`
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
                    }
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
              </div>

              <table className="appbox table experiment-table gbtable responsive-table">
                <thead>
                  <tr>
                    <th></th>
                    <SortableTH field="name" className="w-100">
                      Holdout Name
                    </SortableTH>
                    {showProjectColumn && (
                      <SortableTH field="projects">Projects</SortableTH>
                    )}
                    <SortableTH field="tags">Tags</SortableTH>
                    <SortableTH field="owner">Owner</SortableTH>
                    <SortableTH field="duration">Date</SortableTH>
                    <SortableTH field="status">Status</SortableTH>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(start, end).map((e) => {
                    return (
                      <tr key={e.id} className="hover-highlight">
                        <td data-title="Watching status:" className="watching">
                          <WatchButton
                            item={e.id}
                            itemType="experiment"
                            type="icon"
                          />
                        </td>
                        <td data-title="Holdout name:" className="p-0">
                          <Link
                            href={`/holdout/${e.id}`}
                            className="d-block p-2"
                          >
                            <div className="d-flex flex-column">
                              <div className="d-flex">
                                <span className="testname">{e.name}</span>
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
                              e.projectName ?? <em>None</em>
                            )}
                          </td>
                        )}

                        <td data-title="Tags:" className="table-tags">
                          <SortedTags
                            tags={Object.values(e.experiment.tags)}
                            useFlex={true}
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
                          {/* <ExperimentStatusIndicator experimentData={e} /> */}
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
            </>
          )}
        </div>
      </div>
      {openNewHoldoutModal && (
        <NewHoldoutForm
          onClose={() => setOpenNewHoldoutModal(false)}
          source="holdouts-list"
          isNewExperiment={true}
        />
      )}
    </>
  );
};

export default HoldoutsPage;
