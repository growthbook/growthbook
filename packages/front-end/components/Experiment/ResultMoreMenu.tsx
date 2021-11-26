import { useRouter } from "next/router";
import { useContext } from "react";
import { FaCog, FaFileDownload, FaPencilAlt } from "react-icons/fa";
import { GrTableAdd } from "react-icons/gr";
import { Queries } from "back-end/types/query";
import { ReportInterface } from "back-end/types/report";
import { useAuth } from "../../services/auth";
import Button from "../Button";
import MoreMenu from "../Dropdown/MoreMenu";
import { UserContext } from "../ProtectedPage";
import ViewAsyncQueriesButton from "../Queries/ViewAsyncQueriesButton";

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
}: {
  editMetrics?: () => void;
  configure?: () => void;
  queries?: Queries;
  queryError?: string;
  hasData?: boolean;
  supportsNotebooks?: boolean;
  id: string;
  generateReport?: boolean;
  notebookUrl?: string;
  notebookFilename?: string;
  hasUserQuery?: boolean;
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const { permissions } = useContext(UserContext);

  return (
    <MoreMenu id="exp-result-actions">
      <button
        className="btn dropdown-item py-2"
        onClick={(e) => {
          e.preventDefault();
          configure();
        }}
      >
        <FaCog className="mr-2" /> Configure Analysis
      </button>
      {queries?.length > 0 && (
        <ViewAsyncQueriesButton
          queries={queries.map((q) => q.query)}
          error={queryError}
          className="dropdown-item py-2"
        />
      )}
      {hasData && queries && !hasUserQuery && generateReport && (
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
          <GrTableAdd className="mr-2" style={{ fontSize: "1.2rem" }} /> Ad-hoc
          Report
        </Button>
      )}

      {hasData && !hasUserQuery && supportsNotebooks && (
        <Button
          color="outline-info"
          className="dropdown-item py-2"
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
      )}

      {permissions.runExperiments && editMetrics && (
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
    </MoreMenu>
  );
}
