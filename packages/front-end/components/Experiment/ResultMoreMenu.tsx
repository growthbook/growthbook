import { useState } from "react";
import { useRouter } from "next/router";
import { FaFileDownload, FaPencilAlt } from "react-icons/fa";
import { BiTable } from "react-icons/bi";
import { Queries } from "back-end/types/query";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  ExperimentSnapshotReportArgs,
  ReportInterface,
} from "back-end/types/report";
import { BsArrowRepeat } from "react-icons/bs";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { DifferenceType } from "back-end/types/stats";
import { useAuth } from "@/services/auth";
import ResultsDownloadButton from "@/components/Experiment/ResultsDownloadButton";
import Button from "@/components/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import track from "@/services/track";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ConfirmModal from "../ConfirmModal";

export default function ResultMoreMenu({
  experiment,
  editMetrics,
  queries,
  queryError,
  hasData,
  supportsNotebooks,
  snapshotId,
  reportArgs,
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
  differenceType,
}: {
  experiment: ExperimentInterfaceStringDates;
  editMetrics?: () => void;
  queries?: Queries;
  queryError?: string;
  hasData?: boolean;
  supportsNotebooks?: boolean;
  snapshotId?: string;
  reportArgs?: ExperimentSnapshotReportArgs;
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
  differenceType: DifferenceType;
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();

  const canEdit = permissionsUtil.canViewExperimentModal(project);

  const canDownloadJupyterNotebook =
    hasData && supportsNotebooks && notebookUrl && notebookFilename;

  const isBandit = experiment?.type === "multi-armed-bandit";

  const isPipelineIncrementalEnabledForDatasource =
    datasource?.settings.pipelineSettings?.mode === "incremental";
  const isExperimentIncludedInIncrementalRefresh =
    isPipelineIncrementalEnabledForDatasource &&
    (datasource?.settings.pipelineSettings?.includedExperimentIds?.includes(
      experiment.id,
    ) ??
      true);

  const [showConfirmForceRefresh, setShowConfirmForceRefresh] = useState(false);

  return (
    <>
      <MoreMenu autoCloseOnClick={false}>
        {(queries?.length ?? 0) > 0 && (
          <ViewAsyncQueriesButton
            queries={queries?.map((q) => q.query) ?? []}
            error={queryError}
            className="dropdown-item py-2"
            display=" View Queries"
          />
        )}
        {forceRefresh &&
          datasource &&
          permissionsUtil.canRunExperimentQueries(datasource) && (
            <button
              className="btn dropdown-item py-2"
              onClick={(e) => {
                e.preventDefault();
                if (isExperimentIncludedInIncrementalRefresh) {
                  setShowConfirmForceRefresh(true);
                } else {
                  forceRefresh();
                }
              }}
            >
              <BsArrowRepeat className="mr-2" /> Re-run All Queries
            </button>
          )}
        {snapshotId &&
        experiment &&
        permissionsUtil.canCreateReport(experiment) ? (
          <Button
            className="dropdown-item py-2"
            color="outline-info"
            onClick={async () => {
              const res = await apiCall<{ report: ReportInterface }>(
                `/experiments/report/${snapshotId}`,
                {
                  method: "POST",
                  body: reportArgs ? JSON.stringify(reportArgs) : undefined,
                },
              );
              if (!res.report) {
                throw new Error("Failed to create report");
              }
              track("Experiment Report: Create", {
                source: "experiment results tab",
              });
              await router.push(`/report/${res.report.id}`);
            }}
          >
            <BiTable className="mr-2" style={{ fontSize: "1.2rem" }} /> New
            Custom Report
          </Button>
        ) : null}
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
                }),
              );

              const name = notebookFilename
                .replace(/[^a-zA-Z0-9_-]+/g, "")
                .replace(/[-]+/g, "_")
                .replace(/[_]{2,}/g, "_");

              const d = new Date()
                .toISOString()
                .slice(0, 10)
                .replace(/-/g, "_");

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
        {canEdit && editMetrics && !isBandit && (
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
            differenceType={differenceType}
            metrics={metrics}
            variations={variations}
            trackingKey={trackingKey || ""}
            dimension={dimension || ""}
          />
        )}
      </MoreMenu>
      {showConfirmForceRefresh && forceRefresh && (
        <ConfirmModal
          title="Re-run All Queries"
          subtitle="This experiment is included in incremental refresh. Re-running all queries will cause the previous results to be discarded and the data will be rescanned for the whole duration of the experiment."
          yesText="Re-run"
          noText="Cancel"
          modalState={showConfirmForceRefresh}
          setModalState={(state) => setShowConfirmForceRefresh(state)}
          onConfirm={() => {
            forceRefresh();
            setShowConfirmForceRefresh(false);
          }}
        />
      )}
    </>
  );
}
