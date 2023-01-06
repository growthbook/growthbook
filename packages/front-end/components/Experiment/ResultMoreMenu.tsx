import { useRouter } from "next/router";
import { FaCog, FaFileDownload, FaPencilAlt } from "react-icons/fa";
import { BiTable } from "react-icons/bi";
import { Queries } from "back-end/types/query";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  ReportInterface,
} from "back-end/types/report";
import { BsArrowRepeat } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import ResultsDownloadButton from "@/components/Experiment/ResultsDownloadButton";
import Button from "@/components/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function ResultMoreMenu({
  editMetrics,
  configure,
  queries,
  queryError,
  hasData,
  supportsNotebooks,
  id,
  generateReport,
  notebookUrl,
  notebookFilename,
  hasUserQuery,
  forceRefresh,
  results,
  metrics,
  variations,
  trackingKey,
  dimension,
  project,
}: {
  editMetrics?: () => void;
  configure: () => void;
  queries?: Queries;
  queryError?: string;
  hasData?: boolean;
  supportsNotebooks?: boolean;
  id: string;
  generateReport?: boolean;
  notebookUrl?: string;
  notebookFilename?: string;
  hasUserQuery?: boolean;
  forceRefresh?: () => Promise<void>;
  results?: ExperimentReportResultDimension[];
  metrics?: string[];
  variations?: ExperimentReportVariation[];
  trackingKey?: string;
  dimension?: string;
  project?: string;
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const permissions = usePermissions();

  const canEdit = permissions.check("createAnalyses", project);

  const canDownloadJupyterNotebook =
    hasData &&
    !hasUserQuery &&
    supportsNotebooks &&
    notebookUrl &&
    notebookFilename;

  return (
    <MoreMenu>
      {canEdit && (
        <button
          className="btn dropdown-item py-2"
          onClick={(e) => {
            e.preventDefault();
            configure();
          }}
        >
          <FaCog className="mr-2" /> Configure Analysis
        </button>
      )}
      {queries?.length > 0 && (
        <ViewAsyncQueriesButton
          queries={queries.map((q) => q.query)}
          error={queryError}
          className="dropdown-item py-2"
        />
      )}
      {forceRefresh && permissions.check("runQueries", "") && (
        <button
          className="btn dropdown-item py-2"
          onClick={(e) => {
            e.preventDefault();
            forceRefresh();
          }}
        >
          <BsArrowRepeat className="mr-2" /> Re-run All Queries
        </button>
      )}
      {hasData && queries && !hasUserQuery && generateReport && canEdit && (
        <Button
          className="dropdown-item py-2"
          color="outline-info"
          onClick={async () => {
            const res = await apiCall<{ report: ReportInterface }>(
              `/experiments/report/${id}`,
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
          <BiTable className="mr-2" style={{ fontSize: "1.2rem" }} /> Ad-hoc
          Report
        </Button>
      )}
      <Tooltip
        shouldDisplay={!canDownloadJupyterNotebook}
        body="To download results as a Jupyter notebook, you must set up a Jupyter Notebook query runner. View our docs for more info."
      >
        <Button
          color="outline-info"
          className="dropdown-item py-2"
          disabled={!canDownloadJupyterNotebook}
          onClick={async () => {
            const res = await apiCall<{ notebook: string }>(notebookUrl, {
              method: "POST",
            });

            const url = URL.createObjectURL(
              new Blob([res.notebook], {
                type: "application/json",
              })
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
          <FaFileDownload className="mr-2" style={{ fontSize: "1.2rem" }} />{" "}
          Download Notebook
        </Button>
      </Tooltip>
      {canEdit && editMetrics && (
        <button
          type="button"
          className="dropdown-item py-2"
          onClick={() => {
            editMetrics();
          }}
        >
          <FaPencilAlt className="mr-2" /> Add/Remove Metrics
        </button>
      )}
      {results && (
        <ResultsDownloadButton
          results={results}
          metrics={metrics}
          variations={variations}
          trackingKey={trackingKey}
          dimension={dimension}
        />
      )}
    </MoreMenu>
  );
}
