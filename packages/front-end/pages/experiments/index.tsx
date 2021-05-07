import React, { useContext } from "react";
import useApi from "../../hooks/useApi";
import { useState } from "react";
import clsx from "clsx";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { phaseSummary } from "../../services/utils";
import { datetime } from "../../services/dates";
import StatusIndicator from "../../components/Experiment/StatusIndicator";
import ResultsIndicator from "../../components/Experiment/ResultsIndicator";
import { UserContext } from "../../components/ProtectedPage";
import { useRouter } from "next/router";
import { useSearch } from "../../services/search";
import { FaPlus } from "react-icons/fa";
import WatchButton from "../../components/Experiment/WatchButton";
import useGlobalMenu from "../../services/useGlobalMenu";
import { BsFilter } from "react-icons/bs";
import { useMetrics } from "../../services/MetricsContext";
import { useTags } from "../../services/TagsContext";
import NewExperimentForm from "../../components/Experiment/NewExperimentForm";

const ExperimentsPage = (): React.ReactElement => {
  const { data, error } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>("/experiments");

  const { metrics, getDisplayName, ready: metricsReady } = useMetrics();
  const { tags, tagsReady } = useTags();

  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);
  const [filters, setFilters] = useState({
    status: { selected: ["all"], open: false },
    metrics: { selected: ["all"], open: false },
    tags: { selected: ["all"], open: false },
  });

  const { getUserDisplay, permissions } = useContext(UserContext);

  const router = useRouter();

  const { list: experiments, searchInputProps } = useSearch(
    data?.experiments || [],
    [
      "name",
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
    ]
  );

  // Pass the selector of the menu and a function to close it
  // When a click happens on an element that is not inside of selector,
  // the close function will fire
  useGlobalMenu(".submenu, .filtericon", () => {
    // close all menus:
    const tmp = { ...filters };
    tmp.tags.open = false;
    tmp.metrics.open = false;
    tmp.status.open = false;
    setFilters(tmp);
  });

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data || !metricsReady || !tagsReady) {
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

  const matchesFilter = (exp: ExperimentInterfaceStringDates) => {
    // Status:
    if (
      filters.status.selected.length &&
      !filters.status.selected.includes("all")
    ) {
      // for status, its a many to one, so the check is simple:
      if (!filters.status.selected.includes(exp.status)) return false;
    }
    // Metrics:
    if (
      filters.metrics.selected.length &&
      !filters.metrics.selected.includes("all")
    ) {
      // we have a many to many - and we want to logical OR them.
      let match = false;
      exp.metrics.forEach((m) => {
        if (filters.metrics.selected.includes(m)) match = true;
      });
      if (!match) return false;
    }
    // Tags:
    if (
      filters.tags.selected.length &&
      !filters.tags.selected.includes("all")
    ) {
      // we have a many to many - and we want to logical OR them.
      let match = false;
      exp.tags.forEach((t) => {
        if (filters.tags.selected.includes(t)) match = true;
      });
      if (!match) return false;
    }

    return true;
  };
  const statusValues = ["draft", "running", "stoppped"];

  const columnsShown = [
    "watch",
    "tags",
    //"owner",
    //"variations",
    //"metrics",
    "dates",
    "status",
    "results",
  ];

  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="filters md-form row mb-3">
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
        <table className="table table-hover experiment-table appbox">
          <thead>
            <tr>
              {columnsShown.includes("watch") && (
                <th className="th-sm watchcol"></th>
              )}
              <th className="th-sm experimentcol" scope="col">
                Experiment
              </th>
              {columnsShown.includes("tags") && (
                <th className="th-sm" scope="col">
                  Tags
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      const tmp = { ...filters };
                      tmp.tags.open = !tmp.tags.open;
                      setFilters(tmp);
                    }}
                    className="filtericon filter-status"
                  >
                    <BsFilter />
                  </a>
                  <div
                    className={`submenu ${
                      filters.tags.open ? "open" : "d-none"
                    }`}
                  >
                    <div className="pointer"></div>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        value=""
                        id="checkt-all"
                        checked={filters.tags.selected.includes("all")}
                        onChange={() => {
                          if (!filters.tags.selected.includes("all")) {
                            const tmp = { ...filters };
                            tmp.tags.selected = ["all"];
                            setFilters(tmp);
                          }
                        }}
                      />
                      <label className="form-check-label" htmlFor="check-all">
                        all
                      </label>
                    </div>
                    {tags.map((t) => {
                      return (
                        <div className={`form-check`} key={t}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            value=""
                            id={`checkt-${t}`}
                            checked={filters.tags.selected.includes(t)}
                            onChange={() => {
                              const tmp = { ...filters };
                              const ind = tmp.tags.selected.indexOf(t);
                              if (ind > -1) {
                                // remove it
                                tmp.tags.selected.splice(ind, 1);
                              } else {
                                const ain = tmp.tags.selected.indexOf("all");
                                if (ain > -1) {
                                  // all is there, remove it:
                                  tmp.tags.selected.splice(ain, 1);
                                }
                                tmp.tags.selected.push(t);
                              }
                              if (tmp.tags.selected.length === 0) {
                                tmp.tags.selected.push("all");
                              }
                              setFilters(tmp);
                            }}
                          />
                          <label
                            className="form-check-label"
                            htmlFor={`checkt-${t}`}
                          >
                            {t}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </th>
              )}
              {columnsShown.includes("owner") && (
                <th
                  className="th-sm d-none d-lg-table-cell ownercol"
                  scope="col"
                >
                  Owner
                </th>
              )}
              {columnsShown.includes("variations") && (
                <th className="th-sm d-none d-xl-table-cell varcol" scope="col">
                  Variations
                </th>
              )}
              {columnsShown.includes("metrics") && (
                <th
                  className="th-sm d-none d-xl-table-cell metriccol"
                  scope="col"
                >
                  Metrics
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      const tmp = { ...filters };
                      tmp.metrics.open = !tmp.metrics.open;
                      setFilters(tmp);
                    }}
                    className="filtericon filter-status"
                  >
                    <BsFilter />
                  </a>
                  <div
                    className={`submenu ${
                      filters.metrics.open ? "open" : "d-none"
                    }`}
                  >
                    <div className="pointer"></div>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        value=""
                        id="checkm-all"
                        checked={filters.metrics.selected.includes("all")}
                        onChange={() => {
                          if (!filters.metrics.selected.includes("all")) {
                            const tmp = { ...filters };
                            tmp.metrics.selected = ["all"];
                            setFilters(tmp);
                          }
                        }}
                      />
                      <label className="form-check-label" htmlFor="check-all">
                        all
                      </label>
                    </div>
                    {metrics.map((m) => {
                      return (
                        <div className={`form-check`} key={m.id}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            value=""
                            id={`checkm-${m.id}`}
                            checked={filters.metrics.selected.includes(m.id)}
                            onChange={() => {
                              const tmp = { ...filters };
                              const ind = tmp.metrics.selected.indexOf(m.id);
                              if (ind > -1) {
                                // remove it
                                tmp.metrics.selected.splice(ind, 1);
                              } else {
                                const ain = tmp.metrics.selected.indexOf("all");
                                if (ain > -1) {
                                  // all is there, remove it:
                                  tmp.metrics.selected.splice(ain, 1);
                                }
                                tmp.metrics.selected.push(m.id);
                              }
                              if (tmp.metrics.selected.length === 0) {
                                tmp.metrics.selected.push("all");
                              }
                              setFilters(tmp);
                            }}
                          />
                          <label
                            className="form-check-label"
                            htmlFor={`checkm-${m.id}`}
                          >
                            {m.name}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </th>
              )}
              {columnsShown.includes("dates") && (
                <th
                  className="th-sm d-none d-xl-table-cell datecol"
                  scope="col"
                >
                  Dates
                </th>
              )}
              {columnsShown.includes("status") && (
                <th className="th-sm statuscol" scope="col">
                  Status
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      const tmp = { ...filters };
                      tmp.status.open = !tmp.status.open;
                      setFilters(tmp);
                    }}
                    className="filtericon filter-status"
                  >
                    <BsFilter />
                  </a>
                  <div
                    className={`submenu ${
                      filters.status.open ? "open" : "d-none"
                    }`}
                  >
                    <div className="pointer"></div>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        value=""
                        id="check-all"
                        checked={filters.status.selected.includes("all")}
                        onChange={() => {
                          if (!filters.status.selected.includes("all")) {
                            const tmp = { ...filters };
                            tmp.status.selected = ["all"];
                            setFilters(tmp);
                          }
                        }}
                      />
                      <label className="form-check-label" htmlFor="check-all">
                        all
                      </label>
                    </div>
                    {statusValues.map((s) => {
                      return (
                        <div className={`form-check form-check-${s}`} key={s}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            value=""
                            id={`check-${s}`}
                            checked={filters.status.selected.includes(s)}
                            onChange={() => {
                              const tmp = { ...filters };
                              const ind = tmp.status.selected.indexOf(s);
                              if (ind > -1) {
                                // remove it
                                tmp.status.selected.splice(ind, 1);
                              } else {
                                const ain = tmp.status.selected.indexOf("all");
                                if (ain > -1) {
                                  // all is there, remove it:
                                  tmp.status.selected.splice(ain, 1);
                                }
                                tmp.status.selected.push(s);
                              }
                              if (tmp.status.selected.length === 0) {
                                tmp.status.selected.push("all");
                              }
                              setFilters(tmp);
                            }}
                          />
                          <label
                            className="form-check-label"
                            htmlFor={`check-${s}`}
                          >
                            {s}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </th>
              )}
              {columnsShown.includes("results") && (
                <th
                  className={clsx("th-sm  d-none d-xl-table-cell")}
                  scope="col"
                >
                  Results
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {experiments.map((test) => {
              if (!matchesFilter(test)) return;
              const currentPhase = test.phases[test.phases.length - 1];
              // get start and end dates by looking for min and max start dates of main and rollup phases
              let startDate, endDate;
              test.phases.forEach((p) => {
                if (p.phase === "main" || p.phase === "ramp") {
                  if (!startDate || p.dateStarted < startDate)
                    startDate = p.dateStarted;
                  if (!endDate || p.dateEnded > endDate) endDate = p.dateEnded;
                }
              });
              let shownMetrics = test.metrics;
              let additionalMetricsText = "";
              if (test.metrics.length > 5) {
                shownMetrics = test.metrics.slice(0, 5);
                additionalMetricsText =
                  "+ " + (test.metrics.length - 5) + " more";
              }
              const dateStr =
                !startDate && !endDate
                  ? ""
                  : datetime(startDate) + " - " + datetime(endDate);
              return (
                <tr key={test.name} style={{ cursor: "pointer" }}>
                  {columnsShown.includes("watch") && (
                    <td className="action-column align-middle">
                      <WatchButton experiment={test.id} type="icon" />
                    </td>
                  )}
                  <td
                    scope="row"
                    className="align-middle"
                    onClick={() => {
                      router.push(
                        "/experiment/[eid]",
                        `/experiment/${test.id}`
                      );
                    }}
                  >
                    <h4 className="testname">{test.name}</h4>
                    {/* <p className="hypothesis">{test.hypothesis}</p> */}
                  </td>
                  {columnsShown.includes("tags") && (
                    <td className="align-middle">
                      {Object.values(test.tags).map((col) => (
                        <span
                          className="tag badge badge-secondary mr-2"
                          key={col}
                          onClick={() => {
                            const tmp = { ...filters };
                            if (!filters.tags.selected.includes(col)) {
                              tmp.tags.selected = [col];
                              setFilters(tmp);
                            }
                          }}
                        >
                          {col}
                        </span>
                      ))}
                    </td>
                  )}
                  {columnsShown.includes("owner") && (
                    <td
                      className="d-none d-lg-table-cell align-middle"
                      onClick={() => {
                        router.push(
                          "/experiment/[eid]",
                          `/experiment/${test.id}`
                        );
                      }}
                    >
                      {getUserDisplay(test.owner)}
                    </td>
                  )}
                  {columnsShown.includes("variations") && (
                    <td
                      className="d-none d-xl-table-cell align-middle"
                      onClick={() => {
                        router.push(
                          "/experiment/[eid]",
                          `/experiment/${test.id}`
                        );
                      }}
                    >
                      {test.variations.length}
                    </td>
                  )}
                  {columnsShown.includes("metrics") && (
                    <td className="d-none d-lg-table-cell align-middle">
                      {Object.values(shownMetrics).map((m) => (
                        <span
                          className="tag badge badge-primary mr-2"
                          key={m}
                          onClick={() => {
                            const tmp = { ...filters };
                            if (!filters.metrics.selected.includes(m)) {
                              tmp.metrics.selected = [m];
                              setFilters(tmp);
                            }
                          }}
                        >
                          {getDisplayName(m)}
                        </span>
                      ))}
                      {additionalMetricsText}
                    </td>
                  )}
                  {columnsShown.includes("dates") && (
                    <td className="d-none d-xl-table-cell small align-middle">
                      {dateStr}
                    </td>
                  )}
                  {columnsShown.includes("status") && (
                    <td className="small align-middle">
                      <StatusIndicator
                        status={test.status}
                        archived={test.archived}
                      />
                    </td>
                  )}
                  {columnsShown.includes("results") && (
                    <td className="d-none d-xl-table-cell align-middle">
                      {test.status === "running" && currentPhase
                        ? phaseSummary(currentPhase)
                        : ""}
                      {test.status === "stopped" && (
                        <ResultsIndicator results={test.results} />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
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
