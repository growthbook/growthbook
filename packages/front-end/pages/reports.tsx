import React, { useMemo, useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import { FaSort, FaSortUp, FaSortDown } from "react-icons/fa";
import { datetime, ago } from "../services/dates";
import { useRouter } from "next/router";
import Link from "next/link";
import { useSearch } from "../services/search";
import Tooltip from "../components/Tooltip";
import useApi from "../hooks/useApi";
import { ReportInterface } from "back-end/types/report";
import { ExperimentInterface } from "back-end/types/experiment";
import Toggle from "../components/Forms/Toggle";
import experiments from "./experiments";
import useUser from "../hooks/useUser";

const ReportsPage = (): React.ReactElement => {
  const router = useRouter();

  const { data, error } = useApi<{
    reports: ReportInterface[];
    experiments: ExperimentInterface[];
  }>(`/reports`);

  const [reportSort, setReportsSort] = useState({
    field: "dateUpdated",
    dir: 1,
  });
  const [onlyMyReports, setOnlyMyReports] = useState(true);

  const setSort = (field: string) => {
    if (reportSort.field === field) {
      // switch dir:
      setReportsSort({ ...reportSort, dir: reportSort.dir * -1 });
    } else {
      setReportsSort({ field, dir: 1 });
    }
  };

  const { users, userId, getUserDisplay } = useUser();
  const expMap = useMemo(() => {
    const tmp = new Map();
    if (data?.experiments && data?.experiments.length > 0) {
      data.experiments.forEach((e) => {
        tmp.set(e.id, e);
      });
    }
    return tmp;
  }, [data?.experiments]);

  const getExperimentName = (experimentId: string): string => {
    return expMap.get(experimentId)?.name ?? "";
  };

  const transforms = useMemo(() => {
    return {
      userId: (orig: string) => getUserDisplay(orig),
      experimentId: (orig: string) => getExperimentName(orig),
    };
  }, [getUserDisplay, users.size, experiments]);

  const {
    list: filteredReports,
    searchInputProps,
    isFiltered,
  } = useSearch(
    data?.reports || [],
    ["title", "description", "experimentId", "userId", "dateUpdated"],
    transforms
  );

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const reports = data?.reports || [];

  if (!reports.length) {
    return (
      <div className="container p-4">
        <h1>Reports</h1>
        <p>
          A report is an ad-hoc analysis of an experiment. Use them to explore
          results in an isolated environment without affecting the main
          experiment.
        </p>

        <p>To create your first report:</p>
        <ol>
          <li>Go to an experiment</li>
          <li>Click on the Results tab</li>
          <li>Open the more menu (3 dots next to the Update button)</li>
          <li>Select &quot;ad-hoc report&quot;</li>
        </ol>

        <Link href="/experiments">
          <a className="btn btn-primary mb-2">Go to Experiments</a>
        </Link>

        <p>
          <em>Note:</em> you will not see the &quot;ad-hoc report&quot; option
          if your experiment does not have results yet or is not hooked up to a
          valid data source.
        </p>
      </div>
    );
  }

  // filter and sort the Reports:
  const sortedReports = filteredReports
    .filter((r) => {
      if (onlyMyReports) {
        return r.userId === userId;
      } else {
        // when showing 'all' show all your reports, but only published reports from everyone else (or if status isn't set because it was before the change)
        return r.userId === userId || r?.status === "published" || !r?.status;
      }
    })
    .sort((a, b) => {
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
            Custom Reports{" "}
            <small className="text-muted">
              <Tooltip body="Reports are used by data teams to explore experiment results" />
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
        <div className="col-auto">
          <Toggle
            id={"onlymine"}
            value={onlyMyReports}
            label={"onlymine"}
            setValue={setOnlyMyReports}
          />
          Show only my reports
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
            <th style={{ maxWidth: "30%" }}>
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort("description");
                }}
              >
                Description{" "}
                <a
                  href="#"
                  className={
                    reportSort.field === "description"
                      ? "activesort"
                      : "inactivesort"
                  }
                >
                  {reportSort.field === "description" ? (
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
                  setSort("status");
                }}
              >
                Status{" "}
                <a
                  href="#"
                  className={
                    reportSort.field === "status"
                      ? "activesort"
                      : "inactivesort"
                  }
                >
                  {reportSort.field === "status" ? (
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
            <th>
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort("userId");
                }}
              >
                Created By{" "}
                <a
                  href="#"
                  className={
                    reportSort.field === "userId"
                      ? "activesort"
                      : "inactivesort"
                  }
                >
                  {reportSort.field === "userId" ? (
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
          {sortedReports.map((report) => {
            const name = report?.userId ? getUserDisplay(report?.userId) : "-";
            return (
              <tr
                key={report.id}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(`/report/${report.id}`);
                }}
                style={{ cursor: "pointer" }}
                className=""
              >
                <td>
                  <Link href={`/report/${report.id}`}>
                    <a className={`text-dark font-weight-bold`}>
                      {report.title}
                    </a>
                  </Link>
                </td>
                <td
                  className="text-muted"
                  style={{
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "260px",
                    overflow: "hidden",
                  }}
                >
                  {report.description}
                </td>
                <td>{report.status === "private" ? "private" : "published"}</td>
                <td>{getExperimentName(report.experimentId)}</td>
                <td>{name}</td>
                <td
                  title={datetime(report.dateUpdated)}
                  className="d-none d-md-table-cell"
                >
                  {ago(report.dateUpdated)}
                </td>
              </tr>
            );
          })}

          {!sortedReports.length && (
            <tr>
              <td colSpan={6} align={"center"}>
                {isFiltered
                  ? "No matching reports"
                  : onlyMyReports
                  ? "You have no reports"
                  : "No reports"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ReportsPage;
