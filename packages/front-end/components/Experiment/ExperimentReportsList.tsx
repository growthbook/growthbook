import { ReportInterface } from "back-end/types/report";
import Link from "next/link";
import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useRouter } from "next/router";
import { ago, datetime } from "shared/dates";
import { FaExclamationTriangle } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ShareStatusBadge from "@/components/Report/ShareStatusBadge";

export default function ExperimentReportsList({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { userId, users } = useUser();

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
  const isAdmin = permissionsUtil.canSuperDeleteReport();

  return (
    <div className="px-4 mb-4">
      <table className="table appbox gbtable table-hover mb-0">
        <thead>
          <tr>
            <th>Title</th>
            <th>Description</th>
            <th>Status</th>
            <th>Phase</th>
            <th className="d-none d-md-table-cell">Last Updated</th>
            <th>By</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            const user = report.userId ? users.get(report.userId) : null;
            const name = user ? user.name : "";

            const phaseIndex =
              typeof report.snapshot === "object" && report.snapshot !== null
                ? report.snapshot.phase
                : 0;
            const phaseName =
              report.experimentMetadata.phases[phaseIndex]?.name || "Unknown";

            const status =
              report.type === "experiment"
                ? report.status === "private"
                  ? "private"
                  : "organization"
                : report.shareLevel === "public"
                ? "public"
                : report.shareLevel === "private"
                ? "private"
                : "organization";

            return (
              <tr key={report.id} className="">
                <td
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/report/${report.id}`);
                  }}
                >
                  <div className="d-flex align-items-center">
                    {report.type === "experiment" && report.error ? (
                      <Tooltip
                        body={report.error}
                        className="d-flex align-items-center"
                      >
                        <FaExclamationTriangle color="red" className="mr-2" />
                      </Tooltip>
                    ) : null}

                    <Link
                      href={`/report/${report.id}`}
                      className="text-dark font-weight-bold"
                    >
                      {report.title}
                    </Link>
                  </div>
                </td>
                <td
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/report/${report.id}`);
                  }}
                >
                  <Link href={`/report/${report.id}`} className="text-dark">
                    {report.description}
                  </Link>
                </td>
                <td>
                  <ShareStatusBadge
                    shareLevel={status}
                    editLevel={
                      report.type === "experiment-snapshot"
                        ? report.editLevel
                        : "organization"
                    }
                    isOwner={userId === report?.userId || !report?.userId}
                  />
                </td>
                <td>{phaseName || "Unknown"}</td>
                <td
                  title={datetime(report.dateUpdated)}
                  className="d-none d-md-table-cell"
                >
                  {ago(report.dateUpdated)}
                </td>
                <td>{name}</td>
                <td style={{ width: 50 }}>
                  {(userId === report?.userId || isAdmin) && (
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
                          }
                        );
                        mutate();
                      }}
                    />
                  )}
                </td>
              </tr>
            );
          })}
          {!reports.length && (
            <tr>
              <td colSpan={7} align={"center"}>
                No custom reports created
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
