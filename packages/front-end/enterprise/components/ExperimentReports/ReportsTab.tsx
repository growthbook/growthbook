import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useState } from "react";
import { ExperimentReportInterface } from "back-end/src/enterprise/validators/experiment-report";
import Button from "@/components/Radix/Button";
import { useAuth } from "@/services/auth";
import Link from "@/components/Radix/Link";
import ReportEditor from "./ReportEditor";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

export default function ReportsTab({ experiment, mutate }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [report, setReport] = useState<ExperimentReportInterface | undefined>(
    undefined
  );
  const { apiCall } = useAuth();

  if (isEditing || report) {
    return (
      <ReportEditor
        back={() => {
          setReport(undefined);
          setIsEditing(false);
        }}
        cancel={() => setIsEditing(false)}
        setEditing={setIsEditing}
        submit={async (
          reportData: Pick<ExperimentReportInterface, "title" | "content">
        ) => {
          const res = await apiCall<{
            status: number;
            report: ExperimentReportInterface;
          }>(`/experiments/${experiment.id}/reports/${report?.id || ""}`, {
            method: report ? "PUT" : "POST",
            body: JSON.stringify(reportData),
          });
          if (res.status === 200) {
            setReport(res.report);
            setIsEditing(false);
            mutate();
          } else {
            console.error(res);
          }
        }}
        experiment={experiment}
        report={report}
        isEditing={isEditing}
        mutate={mutate}
      />
    );
  }

  if ((experiment?.reports?.length || 0) === 0) {
    return (
      <div className="mt-3">
        <div className="appbox mx-3 p-4">
          <div className="text-center">
            <h3>No Reports Yet</h3>
            <p className="text-muted mb-4">
              Create your first report to analyze and share experiment results.
            </p>
            <Button
              onClick={() => {
                setIsEditing(true);
              }}
            >
              Create New Report
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="appbox mx-3 p-4">
        <div className="text-center">
          <h3>Choose a Report</h3>
          <p className="text-muted mb-4">Select a report to view or edit.</p>
          <div className="d-flex flex-column gap-2">
            {experiment.reports!.map((r) => (
              <Link key={r.id} onClick={() => setReport(r)}>
                {r.title}
              </Link>
            ))}
            <Button
              onClick={() => {
                setIsEditing(true);
              }}
            >
              Create New Report
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
