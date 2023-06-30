import { ReportInterface } from "back-end/types/report";
import Link from "next/link";
import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useRouter } from "next/router";
import { ago, datetime } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import { useUser } from "@/services/UserContext";
import { trackReport } from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import DeleteButton from "../DeleteButton/DeleteButton";
import Button from "../Button";
import { GBAddCircle } from "../Icons";
import { useSnapshot } from "./SnapshotProvider";

export default function ExperimentReportsList({
  experiment,
  newUi,
}: {
  experiment: ExperimentInterfaceStringDates;
  newUi?: boolean;
}) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const permissions = usePermissions();
  const { userId, users } = useUser();
  const { snapshot, analysis } = useSnapshot();
  const { getDatasourceById } = useDefinitions();

  const { data, error, mutate } = useApi<{
    reports: ReportInterface[];
  }>(`/experiment/${experiment.id}/reports`);

  if (!experiment.datasource) return null;

  if (error) {
    return null;
  }
  if (!data) {
    return null;
  }

  const { reports } = data;

  if (!reports.length) {
    return null;
  }

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const canCreateReports =
    hasData && snapshot?.queries && permissions.check("createAnalyses", "");

  return (
    <div className={newUi ? "px-4 mb-4" : ""}>
      {!newUi && (
        <div className="row align-items-center mb-2">
          <div className="col">
            <h3 className="mb-0">Custom Reports</h3>
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
                  trackReport(
                    "create",
                    "NewCustomReportButton",
                    getDatasourceById(res.report.args.datasource)?.type || null,
                    res.report
                  );

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
      )}
      <table className="table appbox gbtable table-hover mb-0">
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
            const user = report.userId ? users.get(report.userId) : null;
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
                          trackReport(
                            "delete",
                            "ExperimentReportsList",
                            getDatasourceById(report.args.datasource)?.type ||
                              null,
                            report
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
