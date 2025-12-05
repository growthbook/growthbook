import { useState } from "react";
import { useRouter } from "next/router";
import { FaFileDownload, FaPencilAlt, FaPlay } from "react-icons/fa";
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
import { useAuth } from "@/services/auth";
import ResultsDownloadButton from "@/components/Experiment/ResultsDownloadButton";
import Button from "@/components/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import track from "@/services/track";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";

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
}: {
  experiment?: ExperimentInterfaceStringDates;
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
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const { mutateDefinitions } = useDefinitions();
  const canEdit = permissionsUtil.canViewExperimentModal(project);

  const canDownloadJupyterNotebook =
    hasData && supportsNotebooks && notebookUrl && notebookFilename;

  const isBandit = experiment?.type === "multi-armed-bandit";

  const isExperimentIncludedInIncrementalRefresh = experiment
    ? getIsExperimentIncludedInIncrementalRefresh(
        datasource ?? undefined,
        experiment.id,
      )
    : false;

  const isExperimentExcludedFromIncrementalRefresh = experiment
    ? datasource &&
      datasource.settings?.pipelineSettings?.mode === "incremental" &&
      datasource.settings?.pipelineSettings?.excludedExperimentIds?.includes(
        experiment.id,
      )
    : false;

  const [showConfirmForceRefresh, setShowConfirmForceRefresh] = useState(false);

  const rerunAllQueriesText = isExperimentIncludedInIncrementalRefresh
    ? "Full Refresh"
    : "Re-run All Queries";

  const allowFullRefresh =
    !isExperimentIncludedInIncrementalRefresh ||
    (!dimension && isExperimentIncludedInIncrementalRefresh);

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
          permissionsUtil.canRunExperimentQueries(datasource) &&
          allowFullRefresh && (
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
              <BsArrowRepeat className="mr-2" /> {rerunAllQueriesText}
            </button>
          )}
        {datasource &&
          experiment &&
          isExperimentExcludedFromIncrementalRefresh &&
          permissionsUtil.canUpdateDataSourceSettings(datasource) && (
            <Button
              className="dropdown-item py-2"
              color="outline-info"
              onClick={async () => {
                await apiCall(`/datasource/${datasource.id}`, {
                  method: "PUT",
                  body: JSON.stringify({
                    settings: {
                      ...datasource.settings,
                      pipelineSettings: {
                        ...datasource.settings.pipelineSettings,
                        excludedExperimentIds: [
                          ...(datasource.settings?.pipelineSettings
                            ?.excludedExperimentIds ?? []),
                          experiment.id,
                        ].filter((id) => id !== experiment.id),
                      },
                    },
                  }),
                });
                mutateDefinitions();
              }}
            >
              <FaPlay className="mr-2" /> Re-enable Incremental Refresh
            </Button>
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
            metrics={metrics}
            variations={variations}
            trackingKey={trackingKey || ""}
            dimension={dimension || ""}
          />
        )}
      </MoreMenu>
      {showConfirmForceRefresh && forceRefresh && (
        <ConfirmDialog
          title="Full Refresh"
          content={
            <>
              This experiment has Pipeline Mode enabled.
              <br />
              <br />
              Fully refreshing the experiment will re-scan the data source from
              the beginning of the experiment, instead of scanning only new
              data.
            </>
          }
          yesText="I understand"
          noText="Cancel"
          onConfirm={() => {
            forceRefresh();
            setShowConfirmForceRefresh(false);
          }}
          onCancel={() => setShowConfirmForceRefresh(false)}
        />
      )}
    </>
  );
}
