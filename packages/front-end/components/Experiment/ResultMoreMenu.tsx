import { useRouter } from "next/router";
import { FaFileDownload, FaPencilAlt } from "react-icons/fa";
import { BiTable } from "react-icons/bi";
import { Queries } from "back-end/types/query";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  ReportInterface,
} from "back-end/types/report";
import { BsArrowRepeat } from "react-icons/bs";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import ResultsDownloadButton from "@/components/Experiment/ResultsDownloadButton";
import Button from "@/components/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import { trackReport } from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export default function ResultMoreMenu({
  experiment,
  editMetrics,
  queries,
  queryError,
  hasData,
  supportsNotebooks,
  id,
  generateReport,
  notebookUrl,
  notebookFilename,
  forceRefresh,
  results,
  metrics,
  variations,
  trackingKey,
  dimension,
  datasource,
  project,
}: {
  experiment?: ExperimentInterfaceStringDates;
  editMetrics?: () => void;
  queries?: Queries;
  queryError?: string;
  hasData?: boolean;
  supportsNotebooks?: boolean;
  id: string;
  generateReport?: boolean;
  notebookUrl: string;
  notebookFilename: string;
  forceRefresh?: () => Promise<void>;
  results?: ExperimentReportResultDimension[];
  metrics?: string[];
  variations?: ExperimentReportVariation[];
  trackingKey?: string;
  dimension?: string;
  datasource?: DataSourceInterfaceWithParams | null;
  project?: string;
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();

  const canEdit = permissionsUtil.canViewExperimentModal(project);

  const canDownloadJupyterNotebook =
    hasData && supportsNotebooks && notebookUrl && notebookFilename;

  const isBandit = experiment?.type === "multi-armed-bandit";

  return (
    <MoreMenu autoCloseOnClick={false}>
      {(queries?.length ?? 0) > 0 && (
        <ViewAsyncQueriesButton
          queries={queries?.map((q) => q.query) ?? []}
          error={queryError}
          className="dropdown-item py-2"
        />
      )}
      {forceRefresh &&
        datasource &&
        permissionsUtil.canRunExperimentQueries(datasource) && (
          <button
            className="btn dropdown-item py-2"
            onClick={(e) => {
              e.preventDefault();
              forceRefresh();
            }}
          >
            <BsArrowRepeat className="mr-2" /> 重新运行所有查询
          </button>
        )}
      {hasData && queries && generateReport && canEdit && (
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
            trackReport(
              "create",
              "AdhocReportButton",
              getDatasourceById(res.report.args.datasource)?.type || null,
              res.report
            );

            await router.push(`/report/${res.report.id}`);
          }}
        >
          <BiTable className="mr-2" style={{ fontSize: "1.2rem" }} /> 临时报告
          Report
        </Button>
      )}
      <Tooltip
        shouldDisplay={!canDownloadJupyterNotebook}
        body="要将结果下载为Jupyter笔记本，您必须设置一个Jupyter Notebook查询运行器。查看我们的文档以获取更多信息。"
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
          下载Notebook
        </Button>
      </Tooltip>
      {canEdit && editMetrics && !isBandit && (
        <button
          type="button"
          className="dropdown-item py-2"
          onClick={() => {
            editMetrics();
          }}
        >
          <FaPencilAlt className="mr-2" /> 添加/删除指标
        </button>
      )}
      {results && (
        <ResultsDownloadButton
          results={results}
          metrics={metrics}
          variations={variations}
          trackingKey={trackingKey || ""}
          dimension={dimension || ""}
        />
      )}
    </MoreMenu>
  );
}
