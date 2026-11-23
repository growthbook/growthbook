import { Queries } from "shared/types/query";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  ExperimentSnapshotReportInterface,
} from "shared/types/report";
import React, { useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/services/auth";
import ResultsDownloadButton from "@/components/Experiment/ResultsDownloadButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import HelperText from "@/ui/HelperText";

export default function ReportResultMoreMenu({
  report,
  queries,
  queryError,
  hasData,
  supportsNotebooks,
  notebookUrl,
  notebookFilename,
  results,
  metrics,
  variations,
  trackingKey,
  dimension,
  canDelete,
  canDuplicate,
  setNameModalOpen,
}: {
  report: ExperimentSnapshotReportInterface;
  queries?: Queries;
  queryError?: string;
  hasData?: boolean;
  supportsNotebooks?: boolean;
  notebookUrl: string;
  notebookFilename: string;
  results?: ExperimentReportResultDimension[];
  metrics?: string[];
  variations?: ExperimentReportVariation[];
  trackingKey?: string;
  dimension?: string;
  canDelete?: boolean;
  canDuplicate?: boolean;
  setNameModalOpen?: (o: boolean) => void;
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const canDownloadJupyterNotebook =
    hasData && supportsNotebooks && notebookUrl && notebookFilename;

  const menu = (
    <MoreMenu autoCloseOnClick={false} className="ml-2">
      {setNameModalOpen ? (
        <button
          className="dropdown-item py-2"
          onClick={() => setNameModalOpen(true)}
        >
          Edit Name &amp; Description
        </button>
      ) : null}
      {canDuplicate ? (
        <button
          className="dropdown-item py-2"
          disabled={duplicating}
          onClick={async () => {
            setDuplicating(true);
            setDuplicateError(null);
            try {
              const res = await apiCall<{
                report: ExperimentSnapshotReportInterface;
              }>(`/report/${report.id}/duplicate`, { method: "POST" });
              await router.push(`/report/${res.report.id}`);
            } catch (e) {
              setDuplicateError(e instanceof Error ? e.message : String(e));
            } finally {
              setDuplicating(false);
            }
          }}
        >
          Duplicate report
        </button>
      ) : null}
      {(queries?.length ?? 0) > 0 && (
        <ViewAsyncQueriesButton
          queries={queries?.map((q) => q.query) ?? []}
          error={queryError}
          className="dropdown-item py-2"
          icon={null}
        />
      )}
      <Tooltip
        shouldDisplay={!canDownloadJupyterNotebook}
        body="To download results as a Jupyter notebook, you must set up a Jupyter Notebook query runner. View our docs for more info."
      >
        <button
          className="dropdown-item py-2"
          disabled={!canDownloadJupyterNotebook}
          onClick={async () => {
            const res = await apiCall<{ notebook: string }>(notebookUrl, {
              method: "POST",
            });

            const url = URL.createObjectURL(
              new Blob([res.notebook], {
                type: "application/json",
              }),
            );

            const name = notebookFilename
              .replace(/[^a-zA-Z0-9_-]+/g, "")
              .replace(/[-]+/g, "_")
              .replace(/[_]{2,}/g, "_");

            const d = new Date().toISOString().slice(0, 10).replace(/-/g, "_");

            const el = document.createElement("a");
            el.href = url;
            el.download = `${name}_${d}.ipynb`;
            el.click();
          }}
        >
          Download Notebook
        </button>
      </Tooltip>
      {results && (
        <ResultsDownloadButton
          results={results}
          metrics={metrics}
          variations={variations}
          trackingKey={trackingKey || ""}
          dimension={dimension || ""}
          noIcon={true}
        />
      )}
      {canDelete && (
        <>
          <hr className="mx-4 my-2" />
          <DeleteButton
            useRadix={false}
            className="dropdown-item text-danger"
            useIcon={false}
            text="Delete report"
            displayName="Report"
            deleteMessage="Are you sure you want to delete this report?"
            additionalMessage="This cannot be undone"
            onClick={async () => {
              await apiCall<{ status: number; message?: string }>(
                `/report/${report.id}`,
                {
                  method: "DELETE",
                },
              );
              router.push(`/experiment/${report.experimentId}#results`);
            }}
          />
        </>
      )}
    </MoreMenu>
  );

  // The menu closes as soon as an item is clicked, so show the error beside it.
  return (
    <>
      {duplicateError ? (
        <HelperText status="error" size="sm" ml="2">
          {duplicateError}
        </HelperText>
      ) : null}
      {menu}
    </>
  );
}
