import React, { useContext, useMemo } from "react";
import useApi from "../../hooks/useApi";
import { useState } from "react";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { phaseSummary } from "../../services/utils";
import { datetime, ago, getValidDate } from "../../services/dates";
import ResultsIndicator from "../../components/Experiment/ResultsIndicator";
import { UserContext } from "../../components/ProtectedPage";
import { useRouter } from "next/router";
import { useSearch } from "../../services/search";
import { FaPalette, FaPlus } from "react-icons/fa";
import WatchButton from "../../components/Experiment/WatchButton";
import NewExperimentForm from "../../components/Experiment/NewExperimentForm";
import { useDefinitions } from "../../services/DefinitionsContext";
import Tabs from "../../components/Tabs/Tabs";
import Tab from "../../components/Tabs/Tab";
import Pagination from "../../components/Pagination";
import { GBAddCircle } from "../../components/Icons";

const ExperimentsPage = (): React.ReactElement => {
  const { ready, project, getMetricById } = useDefinitions();

  const { data, error } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments?project=${project || ""}`);

  const [showOnlyMyDrafts, setShowOnlyMyDrafts] = useState(false);

  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);

  const { getUserDisplay, permissions, userId, users } = useContext(
    UserContext
  );

  const [currentPage, setCurrentPage] = useState({
    running: 1,
    stopped: 1,
    archived: 1,
    draft: 1,
  });
  const [experimentsPerPage] = useState(20);

  const router = useRouter();

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

  if (!data.experiments.length) {
    return (
      <div className="container p-4">
        <h1>Experiments</h1>
        <p>
          Experiments (also known as A/B Tests or Split Tests) are one of the
          best ways to make data-driven decisions for your business.
        </p>
        <p>
          At their core, Experiments are simple - randomly split your users,
          show each group a different variation of a page, and use statistics
          and data to pick a winner.
        </p>
        <p>
          GrowthBook lets you add context to experiments (hypotheses,
          screenshots, discussion threads) and makes them easily searchable. Our
          Bayesian statistics engine produces intuitive graphs that make it easy
          to interpret results and choose a winner.
        </p>
        {permissions.draftExperiments && (
          <button
            className="btn btn-success btn-lg"
            onClick={() => {
              setOpenNewExperimentModal(true);
            }}
          >
            <FaPlus /> Add your first Experiment
          </button>
        )}
        {openNewExperimentModal && (
          <NewExperimentForm
            onClose={() => setOpenNewExperimentModal(false)}
            source="onboarding"
          />
        )}
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

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-5">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col-auto">
              <h3>All Experiments</h3>
            </div>
            <div style={{ flex: 1 }}></div>
            {permissions.draftExperiments && (
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
                  New Experiment
                </button>
              </div>
            )}
          </div>
          <Tabs
            defaultTab={
              byStatus.running.length > 0
                ? "Running"
                : byStatus.draft.length > 0
                ? "Drafts"
                : byStatus.stopped.length > 0
                ? "Stopped"
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
              anchor="running"
              count={byStatus.running.length}
              padding={false}
            >
              {byStatus.running.length > 0 ? (
                <>
                  <table className="table experiment-table gbtable responsive-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th style={{ width: "99%" }}>Experiment</th>
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
                                <WatchButton experiment={e.id} type="icon" />
                              </td>
                              <td
                                onClick={() => {
                                  router.push(`/experiment/${e.id}`);
                                }}
                                className="cursor-pointer"
                                data-title="Experiment name:"
                              >
                                <div className="d-flex">
                                  <span className="testname">{e.name}</span>
                                  {e.implementation === "visual" && (
                                    <small className="text-muted ml-2">
                                      <FaPalette /> Visual
                                    </small>
                                  )}
                                </div>
                              </td>
                              <td className="nowrap" data-title="Tags:">
                                {Object.values(e.tags).map((col) => (
                                  <span
                                    className="tag badge badge-primary mr-2"
                                    key={col}
                                  >
                                    {col}
                                  </span>
                                ))}
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
              anchor="drafts"
              count={byStatus.draft.length}
              padding={false}
            >
              {showOnlyMyDrafts &&
              permissions.draftExperiments &&
              byStatus.myDrafts.length > 0 ? (
                <>
                  {byStatus.myDrafts.length > 0 && (
                    <>
                      <table className="table experiment-table gbtable responsive-table">
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
                                    <div className="d-flex">
                                      <span className="testname">{e.name}</span>
                                      {e.implementation === "visual" && (
                                        <small className="text-muted ml-2">
                                          <FaPalette /> Visual
                                        </small>
                                      )}
                                    </div>
                                  </td>
                                  <td className="nowrap" data-title="Tags:">
                                    {Object.values(e.tags).map((col) => (
                                      <span
                                        className="tag badge badge-primary mr-2"
                                        key={col}
                                      >
                                        {col}
                                      </span>
                                    ))}
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
                      <table className="table experiment-table gbtable responsive-table">
                        <thead>
                          <tr>
                            <th></th>
                            <th style={{ width: "99%" }}>
                              Experiment
                              {permissions.draftExperiments &&
                                byStatus.myDrafts.length > 0 && (
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
                                  <td data-title="Watching status:">
                                    <WatchButton
                                      experiment={e.id}
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
                                    <div className="d-flex">
                                      <span className="testname">{e.name}</span>
                                      {e.implementation === "visual" && (
                                        <small className="text-muted ml-2">
                                          <FaPalette /> Visual
                                        </small>
                                      )}
                                    </div>
                                  </td>
                                  <td className="nowrap" data-title="Tags:">
                                    {Object.values(e.tags).map((col) => (
                                      <span
                                        className="tag badge badge-primary mr-2"
                                        key={col}
                                      >
                                        {col}
                                      </span>
                                    ))}
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
                                <WatchButton experiment={e.id} type="icon" />
                              </td>
                              <td
                                onClick={() => {
                                  router.push(`/experiment/${e.id}`);
                                }}
                                className="cursor-pointer"
                                data-title="Experiment name:"
                              >
                                <div className="d-flex">
                                  <span className="testname">{e.name}</span>
                                  {e.implementation === "visual" && (
                                    <small className="text-muted ml-2">
                                      <FaPalette /> Visual
                                    </small>
                                  )}
                                </div>
                              </td>
                              <td className="nowrap" data-title="Tags:">
                                {Object.values(e.tags).map((col) => (
                                  <span
                                    className="tag badge badge-primary mr-2"
                                    key={col}
                                  >
                                    {col}
                                  </span>
                                ))}
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
                anchor="archived"
                count={byStatus.archived.length}
              >
                <>
                  <table className="table table-hover experiment-table gbtable responsive-table">
                    <thead>
                      <tr>
                        <th style={{ width: "99%" }}>Experiment</th>
                        <th>Tags</th>
                        <th>Owner</th>
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
                                onClick={() => {
                                  router.push(`/experiment/${e.id}`);
                                }}
                                className="cursor-pointer"
                              >
                                <div className="d-flex">
                                  <span className="testname">{e.name}</span>
                                  {e.implementation === "visual" && (
                                    <small className="text-muted ml-2">
                                      <FaPalette /> Visual
                                    </small>
                                  )}
                                </div>
                              </td>
                              <td className="nowrap">
                                {Object.values(e.tags).map((col) => (
                                  <span
                                    className="tag badge badge-primary mr-2"
                                    key={col}
                                  >
                                    {col}
                                  </span>
                                ))}
                              </td>
                              <td className="nowrap">
                                {getUserDisplay(e.owner, false)}
                              </td>
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
        <NewExperimentForm
          onClose={() => setOpenNewExperimentModal(false)}
          source="experiment-list"
        />
      )}
    </>
  );
};

export default ExperimentsPage;
