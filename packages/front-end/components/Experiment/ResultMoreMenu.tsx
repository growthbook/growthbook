import { useState, useCallback, useMemo } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Queries } from "shared/types/query";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { IconButton } from "@radix-ui/themes";
import { Parser } from "json2csv";
import { useAuth } from "@/services/auth";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/ui/Badge";

export default function ResultMoreMenu({
  experiment,
  editMetrics,
  queries,
  queryError,
  hasData,
  supportsNotebooks,
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
  const permissionsUtil = usePermissionsUtil();
  const { mutateDefinitions } = useDefinitions();
  const canEdit = permissionsUtil.canViewExperimentModal(project);

  const canDownloadJupyterNotebook =
    true || (hasData && supportsNotebooks && notebookUrl && notebookFilename);

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

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);

  const { getExperimentMetricById, getDimensionById, ready } = useDefinitions();

  const rerunAllQueriesText = isExperimentIncludedInIncrementalRefresh
    ? "Full refresh"
    : "Re-run all queries";

  const allowFullRefresh =
    !isExperimentIncludedInIncrementalRefresh ||
    (!dimension && isExperimentIncludedInIncrementalRefresh);

  const dimensionName = dimension
    ? getDimensionById(dimension)?.name ||
      dimension?.split(":")?.[1] ||
      dimension
    : null;

  // Export CSV: Downloads experiment results as CSV with all metric stats
  const handleDownloadCSV = useCallback(() => {
    if (!results || !variations || !metrics || !ready) return;

    type CsvRow = {
      date?: string;
      dimension?: string;
      metric?: string;
      variation?: string;
      riskOfChoosing?: number;
      users?: number;
      totalValue?: number;
      perUserValue?: number;
      perUserValueStdDev?: number | null;
      chanceToBeatControl?: number | null;
      percentChange?: number | null;
      percentChangePValue?: number | null;
      percentChangePValueAdjusted?: number | null;
      percentChangeCILower?: number | null;
      percentChangeCIUpper?: number | null;
      percentChangeCILowerAdjusted?: number | null;
      percentChangeCIUpperAdjusted?: number | null;
    };

    const csvRows: CsvRow[] = [];
    const resultsCopy = [...results];

    if (dimension?.substring(0, 8) === "pre:date") {
      resultsCopy.sort((a, b) => a.name.localeCompare(b.name));
    }

    resultsCopy.forEach((result) => {
      metrics.forEach((metricId) => {
        result.variations.forEach((variation, index) => {
          const stats = variation.metrics[metricId];
          if (!stats) return;

          let metricName = metricId;
          if (metricId.includes("?")) {
            const baseMetricId = metricId.split("?")[0];
            const baseMetric = getExperimentMetricById(baseMetricId);
            if (baseMetric) {
              const queryString = metricId.split("?")[1];
              const params = new URLSearchParams(queryString);
              const sliceParts: string[] = [];
              for (const [key, value] of params.entries()) {
                if (key.startsWith("dim:")) {
                  const column = decodeURIComponent(key.substring(4));
                  const level =
                    value === "" ? "other" : decodeURIComponent(value);
                  sliceParts.push(`${column}: ${level}`);
                }
              }
              metricName = `${baseMetric.name} (${sliceParts.join(", ")})`;
            }
          } else {
            const metric = getExperimentMetricById(metricId);
            if (metric) {
              metricName = metric.name;
            }
          }

          csvRows.push({
            ...(dimensionName && { [dimensionName]: result.name }),
            metric: metricName,
            variation: variations[index].name,
            riskOfChoosing: 0,
            users: stats.users,
            totalValue: stats.value,
            perUserValue: stats.cr,
            perUserValueStdDev: stats.stats?.stddev || null,
            chanceToBeatControl: stats.chanceToWin ?? null,
            percentChange: stats.expected || null,
            percentChangePValue: stats.pValue ?? null,
            percentChangePValueAdjusted: stats.pValueAdjusted ?? null,
            percentChangeCILower: stats.ci?.[0] || null,
            percentChangeCIUpper: stats.ci?.[1] || null,
            percentChangeCILowerAdjusted: stats.ciAdjusted?.[0] ?? null,
            percentChangeCIUpperAdjusted: stats.ciAdjusted?.[1] ?? null,
          });
        });
      });
    });

    if (csvRows.length === 0) return;

    try {
      const json2csvParser = new Parser();
      const csv = json2csvParser.parse(csvRows);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = trackingKey
        ? `${trackingKey}${dimensionName ? `-${dimensionName}` : ""}.csv`
        : "results.csv";
      el.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    }
  }, [
    results,
    variations,
    metrics,
    ready,
    dimension,
    dimensionName,
    getExperimentMetricById,
    trackingKey,
  ]);

  // Download Notebook: Generates and downloads a Jupyter notebook with experiment results
  const handleDownloadNotebook = useCallback(async () => {
    if (!canDownloadJupyterNotebook) return;

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
    URL.revokeObjectURL(url);
  }, [canDownloadJupyterNotebook, notebookUrl, notebookFilename, apiCall]);

  // View Queries: Opens modal showing all async queries for this experiment
  const handleViewQueries = useCallback(() => {
    setQueriesModalOpen(true);
    setDropdownOpen(false);
  }, []);

  // Re-enable Incremental Refresh: Removes experiment from incremental refresh exclusion list
  const handleReenableIncrementalRefresh = useCallback(async () => {
    if (!datasource || !experiment) return;

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
    setDropdownOpen(false);
  }, [datasource, experiment, apiCall, mutateDefinitions]);

  // Re-run All Queries / Full Refresh: Re-runs all queries or performs full refresh (with confirmation for incremental refresh)
  const handleForceRefresh = useCallback(async () => {
    if (!forceRefresh) return;
    await forceRefresh();
    setDropdownOpen(false);
  }, [forceRefresh]);

  const queryStrings = useMemo(
    () => queries?.map((q) => q.query) ?? [],
    [queries],
  );

  return (
    <>
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="full"
            size="3"
            highContrast
          >
            <BsThreeDotsVertical size={18} />
          </IconButton>
        }
        open={dropdownOpen}
        onOpenChange={(o) => {
          setDropdownOpen(!!o);
        }}
        menuPlacement="end"
        variant="soft"
      >
        <DropdownMenuGroup>
          {queryStrings.length > 0 && (
            <DropdownMenuItem onClick={handleViewQueries}>
              View queries
              <Badge
                variant="soft"
                radius="full"
                label={String(queryStrings.length)}
                ml="2"
              />
            </DropdownMenuItem>
          )}
          {forceRefresh &&
            datasource &&
            permissionsUtil.canRunExperimentQueries(datasource) &&
            allowFullRefresh && (
              <DropdownMenuItem
                onClick={handleForceRefresh}
                confirmation={
                  isExperimentIncludedInIncrementalRefresh
                    ? {
                        confirmationTitle: "Full Refresh",
                        cta: "I understand",
                        submit: async () => {
                          if (forceRefresh) {
                            await forceRefresh();
                            setDropdownOpen(false);
                          }
                        },
                        getConfirmationContent: async () => (
                          <>
                            This experiment has Pipeline Mode enabled.
                            <br />
                            <br />
                            Fully refreshing the experiment will re-scan the
                            data source from the beginning of the experiment,
                            instead of scanning only new data.
                          </>
                        ),
                      }
                    : undefined
                }
              >
                {rerunAllQueriesText}
              </DropdownMenuItem>
            )}
          {datasource &&
            experiment &&
            isExperimentExcludedFromIncrementalRefresh &&
            permissionsUtil.canUpdateDataSourceSettings(datasource) && (
              <DropdownMenuItem onClick={handleReenableIncrementalRefresh}>
                Re-enable incremental refresh
              </DropdownMenuItem>
            )}
          <DropdownMenuSeparator />
          {canEdit && editMetrics && !isBandit && (
            <>
              <DropdownMenuItem
                onClick={() => {
                  editMetrics();
                  setDropdownOpen(false);
                }}
              >
                Add / remove metrics
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {canDownloadJupyterNotebook && (
            <DropdownMenuItem onClick={handleDownloadNotebook}>
              Download notebook
            </DropdownMenuItem>
          )}
          {results && (
            <DropdownMenuItem onClick={handleDownloadCSV}>
              Export CSV
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenu>
      {queriesModalOpen && queryStrings.length > 0 && (
        <AsyncQueriesModal
          close={() => setQueriesModalOpen(false)}
          queries={queryStrings}
          savedQueries={[]}
          error={queryError}
        />
      )}
    </>
  );
}
