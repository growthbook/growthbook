import { ReportInterface } from "back-end/types/report";
import { GBAddCircle } from "../Icons";
import Link from "next/link";
import React from "react";
import { ago, datetime } from "../../services/dates";
import { hasFileConfig } from "../../services/env";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../../hooks/useApi";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useAuth } from "../../services/auth";
import { useRouter } from "next/router";

export default function ExperimentReportsList({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}): React.ReactElement {
  const router = useRouter();
  const { apiCall } = useAuth();

  const { data, error } = useApi<{
    reports: ReportInterface[];
  }>(`/reports/${experiment.id}`);

  const { data: sdata, error: serror } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    latest?: ExperimentSnapshotInterface;
  }>(`/experiment/${experiment.id}/snapshot/${experiment.phases.length - 1}`);

  if (error || serror) {
    return null;
  }
  if (!data || !sdata) {
    return null;
  }

  const { reports } = data;
  const snapshot = sdata.snapshot;
  const hasData = snapshot?.results?.[0]?.variations?.length > 0;
  const hasUserQuery = snapshot && !("skipPartialData" in snapshot);
  const canCreateReports = hasData && snapshot?.queries && !hasUserQuery;

  if (!reports.length && (!hasData || !snapshot?.queries)) {
    return (
      <div className="mb-4">This experiment has no results to customize.</div>
    );
  }

  return (
    <div className="mb-4">
      <div className="row mb-3">
        <div className="col">
          <h4>Custom Reports for the Experiment</h4>
        </div>
        {canCreateReports && (
          <div className="col-auto">
            <button
              className="btn btn-primary float-right"
              color="outline-info"
              onClick={async () => {
                const res = await apiCall<{ report: ReportInterface }>(
                  `/experiments/report/${experiment.id}`,
                  {
                    method: "POST",
                  }
                );

                if (!res.report) {
                  throw new Error("Failed to create report");
                }

                await router.push(`/report/${res.report.id}`);
              }}
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              New Custom Report
            </button>
          </div>
        )}
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <th>Title</th>
            <th>Description</th>
            <th className="d-none d-md-table-cell">Last Updated </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
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
              <td>
                <Link href={`/report/${report.id}`}>
                  <a className={`text-dark`}>{report.description}</a>
                </Link>
              </td>
              <td
                title={datetime(report.dateUpdated)}
                className="d-none d-md-table-cell"
              >
                {ago(report.dateUpdated)}
              </td>
            </tr>
          ))}
          {!reports.length && (
            <tr>
              <td colSpan={!hasFileConfig() ? 5 : 4} align={"center"}>
                No custom reports created
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
