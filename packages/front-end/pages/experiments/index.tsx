import React, { useMemo, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { phaseSummary } from "../../services/utils";
import { datetime, ago, getValidDate } from "../../services/dates";
import ResultsIndicator from "../../components/Experiment/ResultsIndicator";
import { useRouter } from "next/router";
import { useSearch } from "../../services/search";
import WatchButton from "../../components/WatchButton";
import { useDefinitions } from "../../services/DefinitionsContext";
import Tabs from "../../components/Tabs/Tabs";
import Tab from "../../components/Tabs/Tab";
import Pagination from "../../components/Pagination";
import { GBAddCircle } from "../../components/Icons";
import ImportExperimentModal from "../../components/Experiment/ImportExperimentModal";
import { useUser } from "../../services/UserContext";
import ExperimentsGetStarted from "../../components/HomePage/ExperimentsGetStarted";
import NewFeatureExperiments from "../../components/Experiment/NewFeatureExperiments";
import SortedTags from "../../components/Tags/SortedTags";

const ExperimentsPage = (): React.ReactElement => {
  const { ready, project, getMetricById, getProjectById } = useDefinitions();

  const { data, error, mutate } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments?project=${project || ""}`);

  const [showOnlyMyDrafts, setShowOnlyMyDrafts] = useState(false);
  const router = useRouter();
  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);

  const { getUserDisplay, permissions, userId, users } = useUser();

  const [currentPage, setCurrentPage] = useState({
    running: 1,
    stopped: 1,
    archived: 1,
    draft: 1,
  });
  const [experimentsPerPage] = useState(20);

  const transforms = useMemo(() => {
    return {
      owner: (orig: string) => getUserDisplay(orig),
      metrics: (orig: string[]) =>
        orig?.map((m) => getMetricById(m)?.name)?.filter(Boolean) || [],
    };
  }, [getMetricById, users.size]);

  const { list: experiments, searchInputProps, isFiltered } = useSearch(
    data?.experiments || [],
    [
      "name",
      "implementation",
      "hypothesis",
      "description",
      "tags",
      "trackingKey",
      "status",
      "id",
      "owner",
      "metrics",
      "results",
      "analysis",
    ],
    transforms
  );

  // If "All Projects" is selected is selected and some experiments are in a project, show the project column
  const showProjectColumn = !project && experiments.some((e) => e.project);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments =
    data.experiments.filter((m) => !m.id.match(/^exp_sample/)).length > 0;

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
          experiments={data?.experiments}
          mutate={mutate}
        />
      </div>
    );
  }

  const byStatus: {
    archived: ExperimentInterfaceStringDates[];
    draft: ExperimentInterfaceStringDates[];
    running: ExperimentInterfaceStringDates[];
    stopped: ExperimentInterfaceStringDates[];
    myDrafts: ExperimentInterfaceStringDates[];
  } = {
    archived: [],
    draft: [],
    running: [],
    stopped: [],
    myDrafts: [],
  };

  experiments.forEach((test) => {
    if (test.archived) {
      byStatus.archived.push(test);
    } else {
      byStatus[test.status].push(test);
    }
  });
  data?.experiments?.forEach((test) => {
    if (!test.archived && test.status === "draft" && test.owner === userId) {
      byStatus.myDrafts.push(test);
    }
  });

  const canAdd = permissions.check("createAnalyses", project);

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
          <Tabs
            defaultTab={
              byStatus.running.length > 0
                ? "running"
                : byStatus.draft.length > 0
                ? "drafts"
                : byStatus.stopped.length > 0
                ? "stopped"
                : null
            }
            newStyle={true}
            navExtra={
              <div className="ml-md-5 ml-0 mt-md-0 mt-3 col-lg-3 col-md-4 col-12">
                <input
                  type="search"
                  className="form-control"
                  placeholder="Search"
                  aria-controls="dtBasicExample"
                  {...searchInputProps}
                />
              </div>
            }
          >
            <Tab
              display="Running"
              id="running"
              anchor="running"
              count={byStatus.running.length}
              padding={false}
            >
              {byStatus.running.length > 0 ? (
                <>
                  <table className="appbox table experiment-table gbtable responsive-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th style={{ width: "99%" }}>Experiment</th>
                        {showProjectColumn && <th>Project</th>}
                        <th>Tags</th>
                        <th>Owner</th>
                        <th>Phase</th>
                        <th>Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byStatus.running
                        .sort(
                          (a, b) =>
                            getValidDate(
                              b.phases[b.phases.length - 1]?.dateStarted
                            ).getTime() -
                            getValidDate(
                              a.phases[a.phases.length - 1]?.dateStarted
                            ).getTime()
                        )
                        .filter((e, i) => {
                          if (
                            i >=
                              (currentPage.running - 1) * experimentsPerPage &&
                            i < currentPage.running * experimentsPerPage
                          )
                            return true;
                        })
                        .map((e) => {
                          const phase = e.phases[e.phases.length - 1];
                          if (!phase) return null;

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
                                onClick={() => {
                                  router.push(`/experiment/${e.id}`);
                                }}
                                className="cursor-pointer"
                                data-title="Experiment name:"
                              >
                                <div className="d-flex flex-column">
                                  <div>
                                    <span className="testname">{e.name}</span>
                                    {e.implementation === "visual" && (
                                      <small className="text-muted ml-2">
                                        (visual)
                                      </small>
                                    )}
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
                                  {getProjectById(e.project)?.name || ""}
                                </td>
                              )}
                              <td className="nowrap" data-title="Tags:">
                                <SortedTags tags={Object.values(e.tags)} />
                              </td>
                              <td className="nowrap" data-title="Owner:">
                                {getUserDisplay(e.owner, false)}
                              </td>
                              <td className="nowrap" data-title="Phase:">
                                {phaseSummary(phase)}
                              </td>
                              <td
                                className="nowrap"
                                title={datetime(phase.dateStarted)}
                                data-title="Created:"
                              >
                                {ago(phase.dateStarted)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {Math.ceil(byStatus.running.length / experimentsPerPage) >
                    1 && (
                    <Pagination
                      numItemsTotal={byStatus.running.length}
                      currentPage={currentPage.running}
                      perPage={experimentsPerPage}
                      onPageChange={(d) => {
                        const tmp = { ...currentPage };
                        tmp.running = d;
                        setCurrentPage(tmp);
                      }}
                    />
                  )}
                </>
              ) : (
                <div className="alert alert-info">
                  No {isFiltered ? "matching" : "running"} experiments
                </div>
              )}
            </Tab>
            <Tab
              display={showOnlyMyDrafts ? "My drafts" : "Drafts"}
              id="drafts"
              anchor="drafts"
              count={
                showOnlyMyDrafts
                  ? byStatus.myDrafts.length
                  : byStatus.draft.length
              }
              padding={false}
            >
              {showOnlyMyDrafts && canAdd && byStatus.myDrafts.length > 0 ? (
                <>
                  {byStatus.myDrafts.length > 0 && (
                    <>
                      <table className="appbox table experiment-table gbtable responsive-table">
                        <thead>
                          <tr>
                            <th style={{ width: "99%" }}>
                              Experiment{" "}
                              <a
                                className="cursor-pointer"
                                onClick={() => {
                                  setShowOnlyMyDrafts(false);
                                }}
                              >
                                (show all drafts)
                              </a>
                            </th>
                            {showProjectColumn && <th>Project</th>}
                            <th>Tags</th>
                            <th>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byStatus.myDrafts
                            .sort(
                              (a, b) =>
                                getValidDate(b.dateCreated).getTime() -
                                getValidDate(a.dateCreated).getTime()
                            )
                            .map((e) => {
                              return (
                                <tr key={e.id} className="hover-highlight">
                                  <td
                                    onClick={() => {
                                      router.push(`/experiment/${e.id}`);
                                    }}
                                    className="cursor-pointer"
                                    data-title="Experiment name:"
                                  >
                                    <div className="d-flex flex-column">
                                      <div>
                                        <span className="testname">
                                          {e.name}
                                        </span>
                                        {e.implementation === "visual" && (
                                          <small className="text-muted ml-2">
                                            (visual)
                                          </small>
                                        )}
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
                                    <td
                                      className="nowrap"
                                      data-title="Project:"
                                    >
                                      {getProjectById(e.project)?.name || ""}
                                    </td>
                                  )}
                                  <td className="nowrap" data-title="Tags:">
                                    <SortedTags tags={Object.values(e.tags)} />
                                  </td>
                                  <td
                                    className="nowrap"
                                    title={datetime(e.dateCreated)}
                                    data-title="Created:"
                                  >
                                    {ago(e.dateCreated)}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              ) : (
                <>
                  {byStatus.draft.length > 0 ? (
                    <>
                      <table className="appbox table experiment-table gbtable responsive-table">
                        <thead>
                          <tr>
                            <th></th>
                            <th style={{ width: "99%" }}>
                              Experiment
                              {canAdd && byStatus.myDrafts.length > 0 && (
                                <span className="pl-3">
                                  <a
                                    className="cursor-pointer"
                                    onClick={() => {
                                      setShowOnlyMyDrafts(true);
                                    }}
                                  >
                                    (show only my drafts)
                                  </a>
                                </span>
                              )}
                            </th>
                            {showProjectColumn && <th>Project</th>}
                            <th>Tags</th>
                            <th>Owner</th>
                            <th>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byStatus.draft
                            .sort(
                              (a, b) =>
                                getValidDate(b.dateCreated).getTime() -
                                getValidDate(a.dateCreated).getTime()
                            )
                            .filter((e, i) => {
                              if (
                                i >=
                                  (currentPage.draft - 1) *
                                    experimentsPerPage &&
                                i < currentPage.draft * experimentsPerPage
                              )
                                return true;
                            })
                            .map((e) => {
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
                                    onClick={() => {
                                      router.push(`/experiment/${e.id}`);
                                    }}
                                    className="cursor-pointer"
                                    data-title="Experiment name:"
                                  >
                                    <div className="d-flex flex-column">
                                      <div>
                                        <span className="testname">
                                          {e.name}
                                        </span>
                                        {e.implementation === "visual" && (
                                          <small className="text-muted ml-2">
                                            (visual)
                                          </small>
                                        )}
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
                                    <td
                                      className="nowrap"
                                      data-title="Project:"
                                    >
                                      {getProjectById(e.project)?.name || ""}
                                    </td>
                                  )}
                                  <td className="nowrap" data-title="Tags:">
                                    <SortedTags tags={Object.values(e.tags)} />
                                  </td>
                                  <td className="nowrap" data-title="Owner:">
                                    {getUserDisplay(e.owner, false)}
                                  </td>
                                  <td
                                    className="nowrap"
                                    title={datetime(e.dateCreated)}
                                    data-title="Created:"
                                  >
                                    {ago(e.dateCreated)}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                      {Math.ceil(byStatus.draft.length / experimentsPerPage) >
                        1 && (
                        <Pagination
                          numItemsTotal={byStatus.draft.length}
                          currentPage={currentPage.draft}
                          perPage={experimentsPerPage}
                          onPageChange={(d) => {
                            const tmp = { ...currentPage };
                            tmp.draft = d;
                            setCurrentPage(tmp);
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <div className="alert alert-info">
                      No {isFiltered ? "matching" : "draft"} experiments
                    </div>
                  )}
                </>
              )}
            </Tab>

            <Tab
              display="Stopped"
              id="stopped"
              anchor="stopped"
              count={byStatus.stopped.length}
              padding={false}
            >
              {byStatus.stopped.length > 0 ? (
                <>
                  <table className="table table-hover experiment-table gbtable responsive-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th style={{ width: "99%" }}>Experiment</th>
                        {showProjectColumn && <th>Project</th>}
                        <th>Tags</th>
                        <th>Owner</th>
                        <th>Ended</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byStatus.stopped
                        .sort(
                          (a, b) =>
                            getValidDate(
                              b.phases[b.phases.length - 1]?.dateEnded
                            ).getTime() -
                            getValidDate(
                              a.phases[a.phases.length - 1]?.dateEnded
                            ).getTime()
                        )
                        .filter((e, i) => {
                          if (
                            i >=
                              (currentPage.stopped - 1) * experimentsPerPage &&
                            i < currentPage.stopped * experimentsPerPage
                          )
                            return true;
                        })
                        .map((e) => {
                          const phase = e.phases[e.phases.length - 1];
                          if (!phase) return null;

                          return (
                            <tr
                              key={e.id}
                              onClick={() => {
                                router.push(`/experiment/${e.id}`);
                              }}
                              className="hover-highlight"
                            >
                              <td
                                data-title="Watch status:"
                                className="watching"
                              >
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
                                  <div>
                                    <span className="testname">{e.name}</span>
                                    {e.implementation === "visual" && (
                                      <small className="text-muted ml-2">
                                        (visual)
                                      </small>
                                    )}
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
                                  {getProjectById(e.project)?.name || ""}
                                </td>
                              )}
                              <td className="nowrap" data-title="Tags:">
                                <SortedTags tags={Object.values(e.tags)} />
                              </td>
                              <td className="nowrap" data-title="Owner:">
                                {getUserDisplay(e.owner, false)}
                              </td>
                              <td
                                className="nowrap"
                                title={datetime(phase.dateEnded)}
                                data-title="Ended:"
                              >
                                {ago(phase.dateEnded)}
                              </td>
                              <td className="nowrap" data-title="Results:">
                                <ResultsIndicator results={e.results} />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {Math.ceil(byStatus.stopped.length / experimentsPerPage) >
                    1 && (
                    <Pagination
                      numItemsTotal={byStatus.stopped.length}
                      currentPage={currentPage.stopped}
                      perPage={experimentsPerPage}
                      onPageChange={(d) => {
                        const tmp = { ...currentPage };
                        tmp.stopped = d;
                        setCurrentPage(tmp);
                      }}
                    />
                  )}
                </>
              ) : (
                <div className="alert alert-info">
                  No {isFiltered ? "matching" : "stopped"} experiments
                </div>
              )}
            </Tab>
            {byStatus.archived.length > 0 && (
              <Tab
                display="Archived"
                id="archived"
                anchor="archived"
                count={byStatus.archived.length}
                padding={false}
              >
                <>
                  <table className="table table-hover experiment-table gbtable responsive-table">
                    <thead>
                      <tr>
                        <th style={{ width: "99%" }}>Experiment</th>
                        {showProjectColumn && <th>Project</th>}
                        <th>Tags</th>
                        <th>Owner</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byStatus.archived
                        .filter((e, i) => {
                          if (
                            i >=
                              (currentPage.archived - 1) * experimentsPerPage &&
                            i < currentPage.archived * experimentsPerPage
                          )
                            return true;
                        })
                        .map((e) => {
                          return (
                            <tr
                              key={e.id}
                              onClick={() => {
                                router.push(`/experiment/${e.id}`);
                              }}
                              className="hover-highlight"
                            >
                              <td
                                onClick={() => {
                                  router.push(`/experiment/${e.id}`);
                                }}
                                className="cursor-pointer"
                              >
                                <div className="d-flex flex-column">
                                  <div>
                                    <span className="testname">{e.name}</span>
                                    {e.implementation === "visual" && (
                                      <small className="text-muted ml-2">
                                        (visual)
                                      </small>
                                    )}
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
                                <td className="nowrap">
                                  {getProjectById(e.project)?.name || ""}
                                </td>
                              )}
                              <td className="nowrap">
                                <SortedTags tags={Object.values(e.tags)} />
                              </td>
                              <td className="nowrap">
                                {getUserDisplay(e.owner, false)}
                              </td>
                              <td className="nowrap">{e.status}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {Math.ceil(byStatus.archived.length / experimentsPerPage) >
                    1 && (
                    <Pagination
                      numItemsTotal={byStatus.archived.length}
                      currentPage={currentPage.archived}
                      perPage={experimentsPerPage}
                      onPageChange={(d) => {
                        const tmp = { ...currentPage };
                        tmp.archived = d;
                        setCurrentPage(tmp);
                      }}
                    />
                  )}
                </>
              </Tab>
            )}
          </Tabs>
        </div>
      </div>
      {openNewExperimentModal && (
        <ImportExperimentModal
          onClose={() => setOpenNewExperimentModal(false)}
          source="experiment-list"
        />
      )}
    </>
  );
};

export default ExperimentsPage;
