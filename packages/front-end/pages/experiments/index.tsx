import React, { useContext } from "react";
import useApi from "../../hooks/useApi";
import { useState } from "react";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { phaseSummary } from "../../services/utils";
import { datetime, ago } from "../../services/dates";
import ResultsIndicator from "../../components/Experiment/ResultsIndicator";
import { UserContext } from "../../components/ProtectedPage";
import { useRouter } from "next/router";
import { useSearch } from "../../services/search";
import { FaPalette, FaPlus } from "react-icons/fa";
import WatchButton from "../../components/Experiment/WatchButton";
import NewExperimentForm from "../../components/Experiment/NewExperimentForm";
import { useDefinitions } from "../../services/DefinitionsContext";
import Link from "next/link";
import Tabs from "../../components/Tabs/Tabs";
import Tab from "../../components/Tabs/Tab";
import Board from "../../components/Plan/Board";

const ExperimentsPage = (): React.ReactElement => {
  const { data, error } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>("/experiments");

  if (Math.random() > 0.00001) {
    return data ? <Board experiments={data.experiments} /> : <LoadingOverlay />;
  }

  const { ready } = useDefinitions();

  const [draftsExpanded, setDraftsExpanded] = useState(false);

  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);

  const { getUserDisplay, permissions, userId } = useContext(UserContext);

  const router = useRouter();

  const {
    list: experiments,
    searchInputProps,
    isFiltered,
  } = useSearch(data?.experiments || [], [
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
  ]);

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
          Growth Book lets you add context to experiments (hypotheses,
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
        {permissions.draftExperiments && byStatus.myDrafts.length > 0 && (
          <div className="mb-5 pb-3 position-relative">
            {!draftsExpanded && byStatus.myDrafts.length > 3 && (
              <div
                className="position-absolute text-center p-4"
                style={{
                  bottom: 20,
                  left: 0,
                  right: 0,
                  background:
                    "linear-gradient(to top, rgba(245,247,250,1) 0%,rgba(245,247,250,0) 100%)",
                }}
              >
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setDraftsExpanded(true);
                  }}
                >
                  See all {byStatus.myDrafts.length} drafts...
                </a>
              </div>
            )}
            <h3>My Drafts</h3>
            <table className="table experiment-table appbox">
              <thead>
                <tr>
                  <th style={{ width: "99%" }}>Experiment</th>
                  <th>Tags</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {byStatus.myDrafts
                  .sort(
                    (a, b) =>
                      new Date(b.dateCreated).getTime() -
                      new Date(a.dateCreated).getTime()
                  )
                  .slice(0, draftsExpanded ? 20 : 3)
                  .map((e) => {
                    return (
                      <tr key={e.id}>
                        <td
                          onClick={() => {
                            router.push(`/experiment/${e.id}`);
                          }}
                        >
                          <div className="d-flex">
                            <h4 className="testname">
                              <Link href={`/experiment/${e.id}`}>
                                <a>{e.name}</a>
                              </Link>
                            </h4>
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
                              className="tag badge badge-secondary mr-2"
                              key={col}
                            >
                              {col}
                            </span>
                          ))}
                        </td>
                        <td className="nowrap" title={datetime(e.dateCreated)}>
                          {ago(e.dateCreated)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mb-5">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col-auto">
              <h3>All Experiments</h3>
            </div>
            <div className="col-lg-3 col-md-4 col-6">
              <input
                type="search"
                className=" form-control"
                placeholder="Search"
                aria-controls="dtBasicExample"
                {...searchInputProps}
              />
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
          >
            <Tab
              display="Running"
              anchor="running"
              count={byStatus.running.length}
            >
              {byStatus.running.length > 0 ? (
                <table className="table experiment-table appbox">
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
                          new Date(
                            b.phases[b.phases.length - 1]?.dateStarted
                          ).getTime() -
                          new Date(
                            a.phases[a.phases.length - 1]?.dateStarted
                          ).getTime()
                      )
                      .map((e) => {
                        const phase = e.phases[e.phases.length - 1];
                        if (!phase) return null;

                        return (
                          <tr key={e.id}>
                            <td>
                              <WatchButton experiment={e.id} type="icon" />
                            </td>
                            <td
                              onClick={() => {
                                router.push(`/experiment/${e.id}`);
                              }}
                            >
                              <div className="d-flex">
                                <h4 className="testname">
                                  <Link href={`/experiment/${e.id}`}>
                                    <a>{e.name}</a>
                                  </Link>
                                </h4>
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
                                  className="tag badge badge-secondary mr-2"
                                  key={col}
                                >
                                  {col}
                                </span>
                              ))}
                            </td>
                            <td className="nowrap">
                              {getUserDisplay(e.owner, false)}
                            </td>
                            <td className="nowrap">{phaseSummary(phase)}</td>
                            <td
                              className="nowrap"
                              title={datetime(phase.dateStarted)}
                            >
                              {ago(phase.dateStarted)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              ) : (
                <div className="alert alert-info">
                  No {isFiltered ? "matching" : "running"} experiments
                </div>
              )}
            </Tab>
            <Tab display="Drafts" anchor="drafts" count={byStatus.draft.length}>
              {byStatus.draft.length > 0 ? (
                <table className="table experiment-table appbox">
                  <thead>
                    <tr>
                      <th></th>
                      <th style={{ width: "99%" }}>Experiment</th>
                      <th>Tags</th>
                      <th>Owner</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byStatus.draft
                      .sort(
                        (a, b) =>
                          new Date(b.dateCreated).getTime() -
                          new Date(a.dateCreated).getTime()
                      )
                      .map((e) => {
                        return (
                          <tr key={e.id}>
                            <td>
                              <WatchButton experiment={e.id} type="icon" />
                            </td>
                            <td
                              onClick={() => {
                                router.push(`/experiment/${e.id}`);
                              }}
                            >
                              <div className="d-flex">
                                <h4 className="testname">
                                  <Link href={`/experiment/${e.id}`}>
                                    <a>{e.name}</a>
                                  </Link>
                                </h4>
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
                                  className="tag badge badge-secondary mr-2"
                                  key={col}
                                >
                                  {col}
                                </span>
                              ))}
                            </td>
                            <td className="nowrap">
                              {getUserDisplay(e.owner, false)}
                            </td>
                            <td
                              className="nowrap"
                              title={datetime(e.dateCreated)}
                            >
                              {ago(e.dateCreated)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              ) : (
                <div className="alert alert-info">
                  No {isFiltered ? "matching" : "draft"} experiments
                </div>
              )}
            </Tab>
            <Tab
              display="Stopped"
              anchor="stopped"
              count={byStatus.stopped.length}
            >
              {byStatus.stopped.length > 0 ? (
                <table className="table table-hover experiment-table appbox">
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
                          new Date(
                            b.phases[b.phases.length - 1]?.dateEnded
                          ).getTime() -
                          new Date(
                            a.phases[a.phases.length - 1]?.dateEnded
                          ).getTime()
                      )
                      .map((e) => {
                        const phase = e.phases[e.phases.length - 1];
                        if (!phase) return null;

                        return (
                          <tr
                            key={e.id}
                            onClick={() => {
                              router.push(`/experiment/${e.id}`);
                            }}
                          >
                            <td>
                              <WatchButton experiment={e.id} type="icon" />
                            </td>
                            <td
                              onClick={() => {
                                router.push(`/experiment/${e.id}`);
                              }}
                            >
                              <div className="d-flex">
                                <h4 className="testname">
                                  <Link href={`/experiment/${e.id}`}>
                                    <a>{e.name}</a>
                                  </Link>
                                </h4>
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
                                  className="tag badge badge-secondary mr-2"
                                  key={col}
                                >
                                  {col}
                                </span>
                              ))}
                            </td>
                            <td className="nowrap">
                              {getUserDisplay(e.owner, false)}
                            </td>
                            <td
                              className="nowrap"
                              title={datetime(phase.dateEnded)}
                            >
                              {ago(phase.dateEnded)}
                            </td>
                            <td className="nowrap">
                              <ResultsIndicator results={e.results} />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
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
                <table className="table table-hover experiment-table appbox">
                  <thead>
                    <tr>
                      <th style={{ width: "99%" }}>Experiment</th>
                      <th>Tags</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byStatus.archived.map((e) => {
                      const phase = e.phases[e.phases.length - 1];
                      if (!phase) return null;

                      return (
                        <tr
                          key={e.id}
                          onClick={() => {
                            router.push(`/experiment/${e.id}`);
                          }}
                        >
                          <td
                            onClick={() => {
                              router.push(`/experiment/${e.id}`);
                            }}
                          >
                            <div className="d-flex">
                              <h4 className="testname">
                                <Link href={`/experiment/${e.id}`}>
                                  <a>{e.name}</a>
                                </Link>
                              </h4>
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
                                className="tag badge badge-secondary mr-2"
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
