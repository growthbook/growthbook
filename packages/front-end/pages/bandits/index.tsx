import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import clsx from "clsx";
import { PiShuffle } from "react-icons/pi";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import LoadingOverlay from "@/components/LoadingOverlay";
import { phaseSummary } from "@/services/utils";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import { useAddComputedFields, useSearch } from "@/services/search";
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
import { useWatching } from "@/services/WatchProvider";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import Button from "@/components/Radix/Button";
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LinkButton from "@/components/Radix/LinkButton";

const NUM_PER_PAGE = 20;

const ExperimentsPage = (): React.ReactElement => {
  const {
    ready,
    project,
    getExperimentMetricById,
    getProjectById,
    getDatasourceById,
  } = useDefinitions();

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
    false
  );
  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);

  const { getUserDisplay, userId, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();

  const [currentPage, setCurrentPage] = useState(1);

  const experiments = useAddComputedFields(
    allExperiments,
    (exp) => {
      const projectId = exp.project;
      const projectName = projectId ? getProjectById(projectId)?.name : "";
      const projectIsDeReferenced = projectId && !projectName;

      return {
        ownerName: getUserDisplay(exp.owner, false) || "",
        metricNames: exp.goalMetrics
          .map((m) => getExperimentMetricById(m)?.name)
          .filter(Boolean),
        datasource: getDatasourceById(exp.datasource)?.name || "",
        projectId,
        projectName,
        projectIsDeReferenced,
        tab: exp.archived
          ? "archived"
          : exp.status === "draft"
          ? "drafts"
          : exp.status,
        date:
          (exp.archived
            ? exp.dateUpdated
            : exp.status === "running"
            ? exp.phases?.[exp.phases?.length - 1]?.dateStarted
            : exp.status === "stopped"
            ? exp.phases?.[exp.phases?.length - 1]?.dateEnded
            : exp.dateCreated) ?? "",
      };
    },
    [getExperimentMetricById, getProjectById, getUserDisplay]
  );

  const { watchedExperiments } = useWatching();

  const filterResults = useCallback(
    (items: typeof experiments) => {
      if (showMineOnly) {
        items = items.filter(
          (item) =>
            item.owner === userId || watchedExperiments.includes(item.id)
        );
      }

      items = filterByTags(items, tagsFilter.tags);

      return items;
    },
    [showMineOnly, userId, tagsFilter.tags, watchedExperiments]
  );

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: experiments,
    localStorageKey: "experiments",
    defaultSortField: "date",
    defaultSortDir: -1,
    searchFields: [
      "name^3",
      "trackingKey^2",
      "id",
      "hypothesis^2",
      "description",
      "tags",
      "status",
      "ownerName",
      "metricNames",
      "results",
      "analysis",
    ],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.archived) is.push("archived");
        if (item.status === "draft") is.push("draft");
        if (item.status === "running") is.push("running");
        if (item.status === "stopped") is.push("stopped");
        if (item.results === "won") is.push("winner");
        if (item.results === "lost") is.push("loser");
        if (item.results === "inconclusive") is.push("inconclusive");
        if (item.hasVisualChangesets) is.push("visual");
        if (item.hasURLRedirects) is.push("redirect");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.project) has.push("project");
        if (item.hasVisualChangesets) {
          has.push("visualChange", "visualChanges");
        }
        if (item.hasURLRedirects) has.push("redirect", "redirects");
        if (item.linkedFeatures?.length) has.push("features", "feature");
        if (item.hypothesis?.trim()?.length) has.push("hypothesis");
        if (item.description?.trim()?.length) has.push("description");
        if (item.variations.some((v) => !!v.screenshots?.length)) {
          has.push("screenshots");
        }
        return has;
      },
      variations: (item) => item.variations.length,
      variation: (item) => item.variations.map((v) => v.name),
      created: (item) => new Date(item.dateCreated),
      updated: (item) => new Date(item.dateUpdated),
      name: (item) => item.name,
      key: (item) => item.trackingKey,
      trackingKey: (item) => item.trackingKey,
      id: (item) => [item.id, item.trackingKey],
      status: (item) => item.status,
      result: (item) =>
        item.status === "stopped" ? item.results || "unfinished" : "unfinished",
      owner: (item) => [item.owner, item.ownerName],
      tag: (item) => item.tags,
      project: (item) => [item.project, item.projectName],
      feature: (item) => item.linkedFeatures || [],
      datasource: (item) => item.datasource,
      metric: (item) => [
        ...item.metricNames,
        ...getAllMetricIdsFromExperiment(item),
      ],
      goal: (item) => [...item.metricNames, ...item.goalMetrics],
    },
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
    "multi-armed-bandits"
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

  const hasExperiments = experiments.length > 0;

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

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-3">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col d-flex align-items-center">
              <h1>Bandits</h1>
              <span className="mr-auto badge badge-purple text-uppercase ml-2">
                Beta
              </span>
            </div>
            <div style={{ flex: 1 }} />
            {canAdd && (
              <div className="col-auto">
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
              </div>
            )}
          </div>
          <CustomMarkdown page={"experimentList"} />
          {!hasExperiments ? (
            <div className="box py-4 text-center">
              <div className="mx-auto" style={{ maxWidth: 650 }}>
                <h1>Adaptively experiment with bandits.</h1>
                <p style={{ fontSize: "17px" }}>
                  Run adaptive experiments with Bandits.
                </p>
              </div>
              <div
                className="d-flex justify-content-center"
                style={{ gap: "1rem" }}
              >
                <LinkButton
                  href="/getstarted/experiment-guide"
                  variant="outline"
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
                            "bg-white text-secondary": !active,
                            "rounded-left": i === 0,
                            "rounded-right":
                              tab === "archived" ||
                              (tab === "stopped" && !hasArchived),
                          })}
                          style={{
                            fontSize: "1em",
                            opacity: active ? 1 : 0.8,
                            padding: "6px 12px",
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
                <div className="col-auto ml-auto">
                  <Toggle
                    id="my-experiments-toggle"
                    type="toggle"
                    value={showMineOnly}
                    setValue={(value) => {
                      setShowMineOnly(value);
                    }}
                  />{" "}
                  My Bandits Only
                </div>
              </div>

              <table className="appbox table experiment-table gbtable responsive-table">
                <thead>
                  <tr>
                    <th></th>
                    <SortableTH field="name" className="w-100">
                      Bandit
                    </SortableTH>
                    {showProjectColumn && (
                      <SortableTH field="projectName">Project</SortableTH>
                    )}
                    <SortableTH field="tags">Tags</SortableTH>
                    <SortableTH field="ownerName">Owner</SortableTH>
                    <SortableTH field="status">Status</SortableTH>
                    <SortableTH field="date">Date</SortableTH>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(start, end).map((e) => {
                    const phase = e.phases?.[e.phases.length - 1];
                    return (
                      <tr key={e.id} className="hover-highlight">
                        <td data-title="Watching status:" className="watching">
                          <WatchButton
                            item={e.id}
                            itemType="experiment"
                            type="icon"
                          />
                        </td>
                        <td data-title="Bandit name:" className="p-0">
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
                            tags={Object.values(e.tags)}
                            useFlex={true}
                          />
                        </td>
                        <td className="nowrap" data-title="Owner:">
                          {e.ownerName}
                        </td>
                        <td className="nowrap" data-title="Status:">
                          {e.archived ? (
                            <span className="badge badge-secondary">
                              archived
                            </span>
                          ) : (
                            <ExperimentStatusIndicator status={e.status} />
                          )}
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
                        <td className="nowrap" data-title="Summary:">
                          {e.archived ? (
                            ""
                          ) : e.status === "running" && phase ? (
                            phaseSummary(phase, e.type === "multi-armed-bandit")
                          ) : e.status === "stopped" && e.results ? (
                            <ResultsIndicator results={e.results} />
                          ) : (
                            ""
                          )}
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
