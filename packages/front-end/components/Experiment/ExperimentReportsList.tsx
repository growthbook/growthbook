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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

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

  const filteredReports = reports
    .map((report) => {
      const isOwner = userId === report?.userId || !report?.userId;
      const canDelete = isOwner || isAdmin;
      const show = isOwner
        ? true
        : report.type === "experiment"
          ? report.status === "published"
          : report.shareLevel === "public" ||
            report.shareLevel === "organization";
      const showDelete = report.type === "experiment" ? isAdmin : canDelete;
      return { report, show, showDelete, isOwner };
    })
    .filter((fr) => fr.show);

  if (!filteredReports.length) {
    return null;
  }

  return (
    <div className="px-4 mb-4">
      <Table variant="standard" hover className="appbox mb-0">
        <thead>
          <tr>
            <th>Title</TableColumnHeader>
            <th>Description</TableColumnHeader>
            <th>Status</TableColumnHeader>
            <TableColumnHeader className="d-none d-md-table-cell">Last Updated </TableColumnHeader>
            <th>By</TableColumnHeader>
            <th></TableColumnHeader>
          </TableRow>
        </TableHeader>
        <tbody>
          {filteredReports.map((filteredReport) => {
            const report = filteredReport.report;
            const user = report.userId ? users.get(report.userId) : null;
            const name = user ? user.name : "";
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
              <TableRow key={report.id} className="">
                <TableCell
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
                      className={`text-dark font-weight-bold`}
                    >
                      {report.title}
                    </Link>
                  </div>
                </TableCell>
                <TableCell
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/report/${report.id}`);
                  }}
                >
                  <Link href={`/report/${report.id}`} className={`text-dark`}>
                    {report.description}
                  </Link>
                </TableCell>
                <td>
                  <ShareStatusBadge
                    shareLevel={status}
                    editLevel={
                      report.type === "experiment-snapshot"
                        ? report.editLevel
                        : "organization"
                    }
                    isOwner={filteredReport.isOwner}
                  />
                </TableCell>
                <TableCell
                  title={datetime(report.dateUpdated)} className="d-none d-md-table-cell"
                >
                  {ago(report.dateUpdated)}
                </TableCell>
                <td>{name}</TableCell>
                <TableCell style={{ width: 50 }}>
                  {filteredReport.showDelete ? (
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
                          },
                        );
                        mutate();
                      }}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
          {!reports.length && (
            <tr>
              <TableCell colSpan={3} align={"center"}>
                No custom reports created
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
