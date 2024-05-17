import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { datetime, ago } from "shared/dates";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import clsx from "clsx";
import { PiShuffle } from "react-icons/pi";
import useOrgSettings from "@/hooks/useOrgSettings";
import LoadingOverlay from "@/components/LoadingOverlay";
import { phaseSummary } from "@/services/utils";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import { useAddComputedFields, useSearch } from "@/services/search";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { GBAddCircle } from "@/components/Icons";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import AddExperimentModal from "@/components/Experiment/AddExperimentModal";
import ImportExperimentModal from "@/components/Experiment/ImportExperimentModal";
import { AppFeatures } from "@/types/app-features";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import { useWatching } from "@/services/WatchProvider";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const NUM_PER_PAGE = 20;

const ExperimentsPage = (): React.ReactElement => {
  const growthbook = useGrowthBook<AppFeatures>();

  const {
    ready,
    project,
    getExperimentMetricById,
    getProjectById,
  } = useDefinitions();

  const { orgId } = useAuth();

  const { experiments: allExperiments, error, loading } = useExperiments(
    project
  );

  const [tabs, setTabs] = useLocalStorage<string[]>("experiment_tabs", []);
  const tagsFilter = useTagsFilter("experiments");
  const [showMineOnly, setShowMineOnly] = useLocalStorage(
    "showMyExperimentsOnly",
    false
  );
  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);

  const { getUserDisplay, userId } = useUser();
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
        metricNames: exp.metrics
          .map((m) => getExperimentMetricById(m)?.name)
          .filter(Boolean),
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
    [getExperimentMetricById, getProjectById]
  );

  const demoExperimentId = useMemo(() => {
    const projectId = getDemoDatasourceProjectIdForOrganization(orgId || "");
    return experiments.find((e) => e.project === projectId)?.id || "";
  }, [orgId, experiments]);

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

  const hasExperiments = experiments.some(
    (e) => !e.id.match(/^exp_sample/) && e.id !== demoExperimentId
  );

  const canAdd = permissionsUtil.canViewExperimentModal(project);

  const hasArchivedExperiments = experiments.some((item) => item.archived);

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
            <div className="col-auto">
              <h1>Experiments</h1>
            </div>
            <div style={{ flex: 1 }} />
            {settings.powerCalculatorEnabled && (
              <Link
                className="btn btn-outline-primary float-right"
                type="button"
                href="/power-calculator"
              >
                Power Calculator
              </Link>
            )}
            {canAdd && (
              <div className="col-auto">
                <button
                  className="btn btn-primary float-right"
                  onClick={() => {
                    setOpenNewExperimentModal(true);
                  }}
                >
                  <span className="h4 pr-2 m-0 d-inline-block align-top">
                    <GBAddCircle />
                  </span>
                  Add Experiment
                </button>
              </div>
            )}
          </div>
          {!hasExperiments ? (
            <div
              className="appbox d-flex flex-column align-items-center"
              style={{ padding: "70px 305px 60px 305px" }}
            >
              <h1>Test Variations with Targeted Users</h1>
              <p style={{ fontSize: "17px" }}>
                Run unlimited tests with linked feature flags, URL redirects or
                the Visual Editor.
              </p>
              <div className="row">
                <Link href="/getstarted/experiment-guide">
                  {" "}
                  <button className="btn btn-outline-primary mr-2">
                    Setup Instructions
                  </button>
                </Link>
                {canAdd && (
                  <button
                    className="btn btn-primary float-right"
                    onClick={() => {
                      setOpenNewExperimentModal(true);
                    }}
                  >
                    <span className="h4 pr-2 m-0 d-inline-block align-top">
                      <GBAddCircle />
                    </span>
                    Add Experiment
                  </button>
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

                      if (tab === "archived" && !hasArchivedExperiments)
                        return null;

                      return (
                        <button
                          key={tab}
                          className={clsx("border mb-0", {
                            "badge-purple font-weight-bold": active,
                            "bg-white text-secondary": !active,
                            "rounded-left": i === 0,
                            "rounded-right":
                              tab === "archived" ||
                              (tab === "stopped" && !hasArchivedExperiments),
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
                          <span className="badge bg-white border text-dark mr-2">
                            {tabCounts[tab] || 0}
                          </span>
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
                  My Experiments Only
                </div>
              </div>

              <table className="appbox table experiment-table gbtable responsive-table">
                <thead>
                  <tr>
                    <th></th>
                    <SortableTH field="name" className="w-100">
                      Experiment
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
                        <td data-title="Experiment name:" className="p-0">
                          <Link
                            href={`/experiment/${e.id}`}
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
                          {ago(e.date)}
                        </td>
                        <td className="nowrap" data-title="Summary:">
                          {e.archived ? (
                            ""
                          ) : e.status === "running" && phase ? (
                            phaseSummary(phase)
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
      {openNewExperimentModal &&
        (growthbook?.isOn("new-experiment-modal") ? (
          <AddExperimentModal
            onClose={() => setOpenNewExperimentModal(false)}
            source="experiment-list"
          />
        ) : (
          <ImportExperimentModal
            onClose={() => setOpenNewExperimentModal(false)}
            source="experiment-list"
          />
        ))}
    </>
  );
};

export default ExperimentsPage;
