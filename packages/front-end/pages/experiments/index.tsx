import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { datetime, ago } from "shared/dates";
import LoadingOverlay from "@/components/LoadingOverlay";
import { phaseSummary } from "@/services/utils";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import { useAddComputedFields, useSearch } from "@/services/search";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { GBAddCircle } from "@/components/Icons";
import { useUser } from "@/services/UserContext";
import ExperimentsGetStarted from "@/components/HomePage/ExperimentsGetStarted";
import NewFeatureExperiments from "@/components/Experiment/NewFeatureExperiments";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import TabButtons from "@/components/Tabs/TabButtons";
import TabButton from "@/components/Tabs/TabButton";
import { useAnchor } from "@/components/Tabs/ControlledTabs";
import Toggle from "@/components/Forms/Toggle";
import AddExperimentModal from "@/components/Experiment/AddExperimentModal";
import ImportExperimentModal from "@/components/Experiment/ImportExperimentModal";
import { AppFeatures } from "@/types/app-features";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";

const NUM_PER_PAGE = 20;

const ExperimentsPage = (): React.ReactElement => {
  const growthbook = useGrowthBook<AppFeatures>();

  const { ready, project, getMetricById, getProjectById } = useDefinitions();

  const {
    experiments: allExperiments,
    error,
    mutateExperiments,
    loading,
  } = useExperiments(project);

  const [tab, setTab] = useAnchor(["running", "drafts", "stopped", "archived"]);

  const [showMineOnly, setShowMineOnly] = useState(false);
  const router = useRouter();
  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);

  const { getUserDisplay, permissions, userId } = useUser();

  const [currentPage, setCurrentPage] = useState(1);

  const experiments = useAddComputedFields(
    allExperiments,
    (exp) => {
      const projectId = exp.project;
      // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
      const projectName = getProjectById(projectId)?.name || "";
      const projectIsOprhaned = projectId && !projectName;

      return {
        ownerName: getUserDisplay(exp.owner, false) || "",
        metricNames: exp.metrics
          .map((m) => getMetricById(m)?.name)
          .filter(Boolean),
        projectId,
        projectName,
        projectIsOprhaned,
        tab: exp.archived
          ? "archived"
          : exp.status === "draft"
          ? "drafts"
          : exp.status,
        date:
          (exp.status === "running"
            ? exp.phases?.[exp.phases?.length - 1]?.dateStarted
            : exp.status === "stopped"
            ? exp.phases?.[exp.phases?.length - 1]?.dateEnded
            : exp.dateCreated) ?? "",
      };
    },
    [getMetricById, getProjectById]
  );

  const filterResults = useCallback(
    (items: typeof experiments) => {
      if (showMineOnly) {
        items = items.filter((item) => item.owner === userId);
      }
      return items;
    },
    [showMineOnly, userId]
  );

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: experiments,
    localStorageKey: "experiments",
    defaultSortField: "date",
    defaultSortDir: -1,
    searchFields: [
      "name^3",
      "trackingKey^3",
      "id^3",
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
    return items.filter((item) => item.tab === tab);
  }, [items, tab]);

  // If "All Projects" is selected is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && items.some((e) => e.project);

  // Reset to page 1 when a filter is applied or tabs change
  useEffect(() => {
    setCurrentPage(1);
  }, [items.length, tab, showMineOnly]);

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

  const hasExperiments =
    experiments.filter((m) => !m.id.match(/^exp_sample/)).length > 0;

  if (!hasExperiments) {
    return (
      <div className="contents container pagecontents getstarted">
        <h1>Experiment Analysis</h1>
        <p>
          GrowthBook can pull experiment results directly from your data source
          and analyze it with our statistics engine. Start by connecting to your
          data source and defining metrics.
        </p>
        <NewFeatureExperiments />
        <ExperimentsGetStarted
          experiments={experiments}
          mutate={mutateExperiments}
        />
      </div>
    );
  }

  const canAdd = permissions.check("createAnalyses", project);

  const hasArchivedExperiments = items.some((item) => item.archived);

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-5">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col-auto">
              <h3>All Experiments</h3>
            </div>
            <div style={{ flex: 1 }} />
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
          <NewFeatureExperiments />
          <div className="row align-items-center mb-3">
            <div className="col-auto">
              <TabButtons newStyle={true} className="mb-0">
                <TabButton
                  display="Running"
                  anchor="running"
                  count={tabCounts["running"] || 0}
                  active={tab === "running"}
                  onClick={() => setTab("running")}
                />
                <TabButton
                  display="Drafts"
                  anchor="drafts"
                  count={tabCounts["drafts"] || 0}
                  active={tab === "drafts"}
                  onClick={() => setTab("drafts")}
                />
                <TabButton
                  display="Stopped"
                  anchor="stopped"
                  count={tabCounts["stopped"] || 0}
                  active={tab === "stopped"}
                  onClick={() => setTab("stopped")}
                  last={!hasArchivedExperiments}
                />
                {hasArchivedExperiments && (
                  <TabButton
                    display="Archived"
                    anchor="archived"
                    count={tabCounts["archived"] || 0}
                    active={tab === "archived"}
                    onClick={() => setTab("archived")}
                    last={true}
                  />
                )}
              </TabButtons>
            </div>
            <div className="col-auto">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
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
                {!showMineOnly && (
                  <SortableTH field="ownerName">Owner</SortableTH>
                )}
                {tab === "running" && <th>Phase</th>}
                <SortableTH field="date">
                  {tab === "running"
                    ? "Started"
                    : tab === "stopped"
                    ? "Ended"
                    : tab === "drafts"
                    ? "Created"
                    : "Date"}
                </SortableTH>
                {tab === "stopped" && (
                  <SortableTH field="results">Result</SortableTH>
                )}
                {tab === "archived" && (
                  <SortableTH field="status">State</SortableTH>
                )}
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
                    <td
                      onClick={() => {
                        router.push(`/experiment/${e.id}`);
                      }}
                      className="cursor-pointer"
                      data-title="Experiment name:"
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
                    </td>
                    {showProjectColumn && (
                      <td className="nowrap" data-title="Project:">
                        {e.projectIsOprhaned ? (
                          <Tooltip
                            body={
                              <>
                                Project <code>{e.project}</code> not found
                              </>
                            }
                          >
                            <span className="text-danger">Invalid project</span>
                          </Tooltip>
                        ) : (
                          e.projectName ?? <em>All Projects</em>
                        )}
                      </td>
                    )}
                    <td className="nowrap" data-title="Tags:">
                      <SortedTags tags={Object.values(e.tags)} />
                    </td>
                    {!showMineOnly && (
                      <td className="nowrap" data-title="Owner:">
                        {e.ownerName}
                      </td>
                    )}
                    {tab === "running" && (
                      <td className="nowrap" data-title="Phase:">
                        {phase && phaseSummary(phase)}
                      </td>
                    )}
                    <td className="nowrap" title={datetime(e.date)}>
                      {ago(e.date)}
                    </td>
                    {tab === "stopped" && (
                      <td className="nowrap" data-title="Results:">
                        {/* @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ExperimentResultsType | undefined' is not as... Remove this comment to see the full error message */}
                        <ResultsIndicator results={e.results} />
                      </td>
                    )}
                    {tab === "archived" && (
                      <td className="nowrap">{e.status}</td>
                    )}
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
        </div>
      </div>
      {openNewExperimentModal &&
        // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
        (growthbook.isOn("new-experiment-modal") ? (
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
