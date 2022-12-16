import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { ReportInterface } from "back-end/types/report";
import { ExperimentInterface } from "back-end/types/experiment";
import LoadingOverlay from "../components/LoadingOverlay";
import { datetime, ago } from "../services/dates";
import { useAddComputedFields, useSearch } from "../services/search";
import Tooltip from "../components/Tooltip/Tooltip";
import useApi from "../hooks/useApi";
import Toggle from "../components/Forms/Toggle";
import { useUser } from "../services/UserContext";
import Field from "../components/Forms/Field";

const ReportsPage = (): React.ReactElement => {
  const router = useRouter();

  const { data, error } = useApi<{
    reports: ReportInterface[];
    experiments: ExperimentInterface[];
  }>(`/reports`);
  const [onlyMyReports, setOnlyMyReports] = useState(true);

  const { userId, getUserDisplay } = useUser();
  const experimentNames = useMemo(() => {
    const map = new Map<string, string>();
    if (data?.experiments && data?.experiments.length > 0) {
      data.experiments.forEach((e) => {
        map.set(e.id, e.name);
      });
    }
    return map;
  }, [data?.experiments]);

  const reports = useAddComputedFields(
    data?.reports,
    (r) => ({
      userName: getUserDisplay(r.userId) || "",
      experimentName: experimentNames.get(r.experimentId) || "",
      status: r.status === "private" ? "private" : "published",
    }),
    [experimentNames]
  );

  const filterResults = useCallback(
    (items: typeof reports) => {
      return items.filter((r) => {
        if (onlyMyReports) {
          return r.userId === userId;
        } else {
          // when showing 'all' show all your reports, but only published reports from everyone else (or if status isn't set because it was before the change)
          return r.userId === userId || r?.status === "published" || !r?.status;
        }
      });
    },
    [onlyMyReports, userId]
  );
  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: reports,
    localStorageKey: "reports",
    defaultSortField: "dateUpdated",
    defaultSortDir: -1,
    searchFields: [
      "title",
      "description",
      "experimentName",
      "userName",
      "dateUpdated",
    ],
    filterResults,
  });

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
          <Field placeholder="Search..." type="search" {...searchInputProps} />
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
            <SortableTH field="title">Title</SortableTH>
            <SortableTH field="description">Description</SortableTH>
            <SortableTH field="status">Status</SortableTH>
            <SortableTH field="experimentName">Experiment</SortableTH>
            <SortableTH field="userName">Created By</SortableTH>
            <SortableTH field="dateUpdated">Last Updated</SortableTH>
          </tr>
        </thead>
        <tbody>
          {items.map((report) => (
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
                  <a className={`text-dark font-weight-bold`}>{report.title}</a>
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
              <td>{report.status}</td>
              <td>{report.experimentName}</td>
              <td>{report.userName}</td>
              <td
                title={datetime(report.dateUpdated)}
                className="d-none d-md-table-cell"
              >
                {ago(report.dateUpdated)}
              </td>
            </tr>
          ))}

          {!items.length && (
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
