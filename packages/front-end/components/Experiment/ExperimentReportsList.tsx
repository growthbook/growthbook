import { ReportInterface } from "back-end/types/report";
import { GBAddCircle } from "../Icons";
import Link from "next/link";
import React from "react";
import { ago, datetime } from "../../services/dates";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "../../hooks/useApi";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useAuth } from "../../services/auth";
import { useRouter } from "next/router";
import Button from "../Button";
import DeleteButton from "../DeleteButton";
import usePermissions from "../../hooks/usePermissions";
import useUser from "../../hooks/useUser";

export default function ExperimentReportsList({
  experiment,
  snapshot,
}: {
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
}): React.ReactElement {
  const router = useRouter();
  const { apiCall } = useAuth();
  const permissions = usePermissions();
  const { userId, users } = useUser();

  const { data, error, mutate } = useApi<{
    reports: ReportInterface[];
  }>(`/experiment/${experiment.id}/reports`);

  if (error) {
    return null;
  }
  if (!data) {
    return null;
  }

  const { reports } = data;
  const hasData = snapshot?.results?.[0]?.variations?.length > 0;
  const hasUserQuery = snapshot && !("skipPartialData" in snapshot);
  const canCreateReports =
    hasData && snapshot?.queries && !hasUserQuery && permissions.createAnalyses;

  if (!reports.length) {
    return null;
  }

  return (
    <div>
      <div className="row mb-3">
        <div className="col">
          <h3 className="mb-3">Custom Reports</h3>
        </div>
        {canCreateReports && (
          <div className="col-auto">
            <Button
              className="btn btn-primary float-right"
              color="outline-info"
              onClick={async () => {
                const res = await apiCall<{ report: ReportInterface }>(
                  `/experiments/report/${snapshot.id}`,
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
            </Button>
          </div>
        )}
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <th>Title</th>
            <th>Description</th>
            <th className="d-none d-md-table-cell">Last Updated </th>
            <th>By</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            const user = users.get(report.userId);
            const name = user ? user.name : "";
            return (
              <tr key={report.id} className="">
                <td
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/report/${report.id}`);
                  }}
                >
                  <Link href={`/report/${report.id}`}>
                    <a className={`text-dark font-weight-bold`}>
                      {report.title}
                    </a>
                  </Link>
                </td>
                <td
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/report/${report.id}`);
                  }}
                >
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
                <td>{name}</td>
                <td style={{ width: 50 }}>
                  {(permissions.superDelete || report.userId === userId) && (
                    <>
                      <DeleteButton
                        displayName="Custom Report"
                        link={true}
                        className="fade-hover"
                        text=""
                        useIcon={true}
                        onClick={async () => {
                          await apiCall<{ status: number; message?: string }>(
                            `/report/${report.id}`,
                            {
                              method: "DELETE",
                              //body: JSON.stringify({ id: report.id }),
                            }
                          );
                          mutate();
                        }}
                      />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {!reports.length && (
            <tr>
              <td colSpan={3} align={"center"}>
                No custom reports created
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
