import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { ReportInterface } from "shared/types/report";
import { ExperimentInterface } from "shared/types/experiment";
import { datetime, ago } from "shared/dates";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import Switch from "@/ui/Switch";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import ShareStatusBadge from "@/components/Report/ShareStatusBadge";
import { useDefinitions } from "@/services/DefinitionsContext";

const ReportsPage = (): React.ReactElement => {
  const router = useRouter();
  const { project } = useDefinitions();

  const { data, error } = useApi<{
    reports: ReportInterface[];
    experiments: ExperimentInterface[];
  }>(`/reports?project=${project || ""}`);
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
      userName: r.userId ? getUserDisplay(r.userId) : "",
      experimentName: r.experimentId ? experimentNames.get(r.experimentId) : "",
      shareLevel: (r.type === "experiment"
        ? r.status === "private"
          ? "private"
          : "organization"
        : r.shareLevel === "public"
          ? "public"
          : r.shareLevel === "private"
            ? "private"
            : "organization") as "public" | "organization" | "private",
    }),
    [experimentNames],
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
    [onlyMyReports, userId],
  );
  const { items, searchInputProps, isFiltered, SortableTH, pagination } =
    useSearch({
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
      pageSize: 20,
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
          A report is a standalone ad-hoc analysis of an experiment. Use them to
          explore results in an isolated environment without affecting the main
          experiment.
        </p>

        <p>To create your first report:</p>
        <ol>
          <li>Go to an experiment</li>
          <li>Click on the Results tab</li>
          <li>Open the more menu (3 dots next to the Update button)</li>
          <li>Select &quot;New Custom Report&quot;</li>
        </ol>

        <Link href="/experiments" className="btn btn-primary mb-2">
          Go to Experiments
        </Link>

        <p>
          <em>Note:</em> you will not see the &quot;New Custom Report&quot;
          option if your experiment does not have results yet or is not hooked
          up to a valid data source.
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
        <Switch
          id={"onlymine"}
          value={onlyMyReports}
          label="Show only my reports"
          onChange={setOnlyMyReports}
        />
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
            >
              <td>
                <Link
                  href={`/report/${report.id}`}
                  className={`text-dark font-weight-bold`}
                >
                  {report.title}
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
              <td>
                <ShareStatusBadge
                  shareLevel={report.shareLevel}
                  editLevel={
                    report.type === "experiment-snapshot"
                      ? report.editLevel
                      : "organization"
                  }
                />
              </td>
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
      {pagination}
    </div>
  );
};

export default ReportsPage;
