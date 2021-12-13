import React, { useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import { FaSort, FaSortUp, FaSortDown } from "react-icons/fa";
import { datetime, ago } from "../services/dates";
import { useRouter } from "next/router";
import Link from "next/link";
import { hasFileConfig } from "../services/env";
import { useSearch } from "../services/search";
import Tooltip from "../components/Tooltip";
import useApi from "../hooks/useApi";
import { ReportInterface } from "back-end/types/report";
import { ExperimentInterface } from "back-end/types/experiment";

const ReportsPage = (): React.ReactElement => {
  const router = useRouter();

  const { data, error } = useApi<{
    reports: ReportInterface[];
    experiments: ExperimentInterface[];
  }>(`/reports`);
  const expMap = new Map();

  const [reportSort, setReportsSort] = useState({
    field: "name",
    dir: 1,
  });

  const setSort = (field: string) => {
    if (reportSort.field === field) {
      // switch dir:
      setReportsSort({ ...reportSort, dir: reportSort.dir * -1 });
    } else {
      setReportsSort({ field, dir: 1 });
    }
  };

  const {
    list: filteredReports,
    searchInputProps,
    isFiltered,
  } = useSearch(data?.reports || [], [
    "title",
    "experimentName",
    "dateUpdated",
  ]);

  const getExperimentName = (experimentId: string): string => {
    return expMap.get(experimentId)?.name ?? "";
  };

  if (error) {
    return <div className="alert alert-danger">An error occurred: {error}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  data.experiments.forEach((e) => {
    expMap.set(e.id, e);
  });

  const reports = data.reports;

  if (!reports.length) {
    return (
      <div className="container p-4">
        <h1>Reports</h1>
        <p>
          Reports are customized analysis of experiment results. They are useful
          for teams to dig into the results and discover new insights and
          learnings.
        </p>

        <p>
          To create your first report, start from the experiment you want to
          analyze and click on &quot;ad-hoc report&quot; from the drop down menu
          on the results page.
        </p>
      </div>
    );
  }

  // sort the Reports:
  const sortedReports = filteredReports.sort((a, b) => {
    const comp1 = a[reportSort.field];
    const comp2 = b[reportSort.field];
    if (typeof comp1 === "string") {
      return comp1.localeCompare(comp2) * reportSort.dir;
    }
    return (comp1 - comp2) * reportSort.dir;
  });

  return (
    <div className="container-fluid py-3 p-3 pagecontents">
      <div className="filters md-form row mb-3 align-items-center">
        <div className="col-auto">
          <h3>
            Your Reports{" "}
            <small className="text-muted">
              <Tooltip text="Reports are used by data teams to explore experiment results" />
            </small>
          </h3>
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
        <div style={{ flex: 1 }} />
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <th>
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort("title");
                }}
              >
                Title{" "}
                <a
                  href="#"
                  className={
                    reportSort.field === "name" ? "activesort" : "inactivesort"
                  }
                >
                  {reportSort.field === "name" ? (
                    reportSort.dir < 0 ? (
                      <FaSortUp />
                    ) : (
                      <FaSortDown />
                    )
                  ) : (
                    <FaSort />
                  )}
                </a>
              </span>
            </th>
            <th>
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort("type");
                }}
              >
                Type{" "}
                <a
                  href="#"
                  className={
                    reportSort.field === "type" ? "activesort" : "inactivesort"
                  }
                >
                  {reportSort.field === "type" ? (
                    reportSort.dir < 0 ? (
                      <FaSortUp />
                    ) : (
                      <FaSortDown />
                    )
                  ) : (
                    <FaSort />
                  )}
                </a>
              </span>
            </th>
            <th>
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort("experimentName");
                }}
              >
                Experiment{" "}
                <a
                  href="#"
                  className={
                    reportSort.field === "experimentName"
                      ? "activesort"
                      : "inactivesort"
                  }
                >
                  {reportSort.field === "experimentName" ? (
                    reportSort.dir < 0 ? (
                      <FaSortUp />
                    ) : (
                      <FaSortDown />
                    )
                  ) : (
                    <FaSort />
                  )}
                </a>
              </span>
            </th>
            <th className="d-none d-md-table-cell">
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort("dateUpdated");
                }}
              >
                Last Updated{" "}
                <a
                  href="#"
                  className={
                    reportSort.field === "dateUpdated"
                      ? "activesort"
                      : "inactivesort"
                  }
                >
                  {reportSort.field === "dateUpdated" ? (
                    reportSort.dir < 0 ? (
                      <FaSortUp />
                    ) : (
                      <FaSortDown />
                    )
                  ) : (
                    <FaSort />
                  )}
                </a>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedReports.map((report) => (
            <tr
              key={report.id}
              onClick={(e) => {
                e.preventDefault();
                router.push("/report/[rid]", `/report/${report.id}`);
              }}
              style={{ cursor: "pointer" }}
              className=""
            >
              <td>
                <Link href={`/report/${report.id}`}>
                  <a className={`text-dark font-weight-bold`}>{report.title}</a>
                </Link>
              </td>
              <td>{report.type}</td>
              <td>{getExperimentName(report.experimentId)}</td>

              <td
                title={datetime(report.dateUpdated)}
                className="d-none d-md-table-cell"
              >
                {ago(report.dateUpdated)}
              </td>
            </tr>
          ))}

          {!sortedReports.length && isFiltered && (
            <tr>
              <td colSpan={!hasFileConfig() ? 5 : 4} align={"center"}>
                No matching reports
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ReportsPage;
