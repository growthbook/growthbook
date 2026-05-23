// TODO(holdout-v1.5): the holdout-vs-bandit comparison view (the "Is the CB
// leading to higher reward?" panel from the original engineering plan)
// attaches in this component. EDF integration for end-of-experiment
// recommendations also lives here. See contextual-bandit-fix-prompt.md.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { startCase } from "lodash";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import type {
  ContextualBanditResponseSnapshot,
  ContextualBanditSnapshot,
} from "shared/types/stats";
import { ATTR_CB_PREFIX } from "shared/constants";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getLatestPhaseVariations,
} from "shared/experiments";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Switch from "@/ui/Switch";
import Callout from "@/ui/Callout";
import Metadata from "@/ui/Metadata";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import RefreshResultsButton from "@/components/Experiment/RefreshResultsButton";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useAuth } from "@/services/auth";
import styles from "./ContextualBanditResultsTable.module.scss";

const numberFormatter = Intl.NumberFormat();

const CONTEXT_COLUMN_WIDTH_PERCENT = 38;

function ContextualBanditColGroup({
  numVariations,
}: {
  numVariations: number;
}) {
  const variationWidthPercent =
    numVariations > 0
      ? (100 - CONTEXT_COLUMN_WIDTH_PERCENT) / numVariations
      : 100 - CONTEXT_COLUMN_WIDTH_PERCENT;
  return (
    <colgroup>
      <col style={{ width: `${CONTEXT_COLUMN_WIDTH_PERCENT}%` }} />
      {Array.from({ length: numVariations }, (_, i) => (
        <col key={i} style={{ width: `${variationWidthPercent}%` }} />
      ))}
    </colgroup>
  );
}

function displayAttributeName(attr: string): string {
  return attr.startsWith(ATTR_CB_PREFIX)
    ? attr.slice(ATTR_CB_PREFIX.length)
    : attr;
}

function shouldShowUpdateMessage(message: string | null | undefined): boolean {
  if (!message?.trim()) return false;
  return message.trim().toLowerCase() !== "successfully updated";
}

function CalloutLike({ children }: { children: ReactNode }) {
  return (
    <Box
      p="3"
      style={{
        borderRadius: 8,
        border: "1px solid var(--gray-a6)",
        background: "var(--gray-a2)",
      }}
    >
      {children}
    </Box>
  );
}

function contextRowLabel(
  row: ContextualBanditResponseSnapshot,
  attributeOrder: string[],
): string {
  const { context } = row;
  const parts: string[] = [];
  for (const attr of attributeOrder) {
    const spec = context[attr];
    if (spec && typeof spec === "object" && "$in" in spec) {
      const allowed = (spec as { $in: unknown }).$in;
      const label = Array.isArray(allowed)
        ? allowed.map((v) => String(v)).join(", ")
        : String(allowed);
      parts.push(`${displayAttributeName(attr)}: ${label}`);
    } else if (spec !== undefined && spec !== null) {
      parts.push(`${displayAttributeName(attr)}: ${String(spec)}`);
    }
  }
  if (parts.length) return parts.join(" · ");
  return JSON.stringify(context);
}

function cellValues(
  row: ContextualBanditResponseSnapshot,
  mode: "weights" | "means",
  numVariations: number,
): (number | null)[] {
  const source =
    mode === "means"
      ? row.variationMeans
      : (row.updatedWeights ?? row.bestArmProbabilities);
  if (!source || source.length === 0) {
    return Array(numVariations).fill(null);
  }
  return Array.from({ length: numVariations }, (_, i) =>
    source[i] !== undefined && source[i] !== null ? Number(source[i]) : null,
  );
}

function contextTotalSampleSize(row: ContextualBanditResponseSnapshot): number {
  const sizes = row.sampleSizePerVariation;
  if (!sizes?.length) return 0;
  return sizes.reduce((sum, n) => sum + (n ?? 0), 0);
}

/** Sample-size-weighted average of per-context variation weights. */
function computeOverallVariationWeights(
  responses: ContextualBanditResponseSnapshot[],
  numVariations: number,
): (number | null)[] {
  if (!responses.length || numVariations === 0) {
    return Array(numVariations).fill(null);
  }

  const contextTotals = responses.map(contextTotalSampleSize);
  const totalUsers = contextTotals.reduce((sum, n) => sum + n, 0);
  const contextWeights =
    totalUsers > 0
      ? contextTotals.map((n) => n / totalUsers)
      : responses.map(() => 1 / responses.length);

  const overall: number[] = Array(numVariations).fill(0);
  const hasContribution = Array(numVariations).fill(false);

  responses.forEach((row, c) => {
    const variationWeights = cellValues(row, "weights", numVariations);
    const contextWeight = contextWeights[c];
    variationWeights.forEach((w, j) => {
      if (w !== null && !Number.isNaN(w)) {
        overall[j] += contextWeight * w;
        hasContribution[j] = true;
      }
    });
  });

  return overall.map((v, j) => (hasContribution[j] ? v : null));
}

function formatCell(value: number | null, mode: "weights" | "means"): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (mode === "weights") {
    if (value > 0 && value < 0.01) {
      return "< 1%";
    }
    const rounded = Math.round(value * 100) / 100;
    return new Intl.NumberFormat(undefined, {
      style: "percent",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(rounded);
  }
  return new Intl.NumberFormat(undefined, {
    maximumSignificantDigits: 3,
  }).format(value);
}

/** Normalize each value to [0, 1] using min/max within the row. */
function rowHeatmapIntensities(values: (number | null)[]): (number | null)[] {
  const numeric = values.filter(
    (v): v is number => v !== null && !Number.isNaN(v),
  );
  if (numeric.length === 0) {
    return values.map(() => null);
  }
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const range = max - min;
  return values.map((v) => {
    if (v === null || Number.isNaN(v)) return null;
    if (range === 0) return 0;
    return (v - min) / range;
  });
}

const HEATMAP_HUE = 214;

function heatmapColor(intensity: number): {
  saturation: number;
  lightness: number;
} {
  return {
    saturation: 72 + intensity * 12,
    lightness: 94 - intensity * 52,
  };
}

function heatmapCellStyle(intensity: number | null): CSSProperties | undefined {
  if (intensity === null) return undefined;
  const { saturation, lightness } = heatmapColor(intensity);
  return {
    backgroundColor: `hsl(${HEATMAP_HUE}, ${saturation}%, ${lightness}%)`,
    borderRadius: 6,
  };
}

function heatmapIsLightCell(intensity: number | null): boolean {
  if (intensity === null) return false;
  return heatmapColor(intensity).lightness > 55;
}

const HEATMAP_LIGHT_TEXT = `hsl(${HEATMAP_HUE}, 45%, 16%)`;

function heatmapTextColor(intensity: number | null): string | undefined {
  if (intensity === null) return undefined;
  return heatmapIsLightCell(intensity) ? HEATMAP_LIGHT_TEXT : "#fff";
}

function HeatmapValueCell({
  value,
  intensity,
  mode,
}: {
  value: number | null;
  intensity: number | null;
  mode: "weights" | "means";
}) {
  const cellStyle = heatmapCellStyle(intensity);
  const textColor = heatmapTextColor(intensity);
  const isLightCell = heatmapIsLightCell(intensity);
  return (
    <TableCell
      justify="end"
      style={cellStyle}
      className={cellStyle ? styles.heatmapCell : undefined}
    >
      <span
        className={isLightCell ? styles.heatmapCellLightText : undefined}
        style={textColor ? { color: textColor } : undefined}
      >
        <Text size="medium">{formatCell(value, mode)}</Text>
      </span>
    </TableCell>
  );
}

export default function ContextualBanditResultsTable({
  experiment,
  contextualBanditSnapshot,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  contextualBanditSnapshot: ContextualBanditSnapshot | null | undefined;
  mutate: () => void;
}) {
  const [mode, setMode] = useState<"weights" | "means">("weights");
  const [refreshError, setRefreshError] = useState("");
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);
  const {
    snapshot,
    latestSummary: latest,
    mutate: mutateSnapshot,
    setSnapshotType,
    setAnalysisSettings,
    phase,
    dimension,
  } = useSnapshot();
  const { getDatasourceById, metricGroups } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;

  const datasourceSettings = datasource?.settings;
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  )?.userIdType;
  const unitDisplayName = userIdType
    ? startCase(userIdType.split("_").join(" ")) + "s"
    : "Units";

  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const allExpandedMetrics = useMemo(
    () =>
      Array.from(
        new Set(
          expandMetricGroups(
            getAllMetricIdsFromExperiment(experiment, false, metricGroups),
            metricGroups,
          ),
        ),
      ),
    [experiment, metricGroups],
  );

  const canRunQueries =
    !!datasource &&
    permissionsUtil.canRunExperimentQueries(datasource) &&
    allExpandedMetrics.length > 0;

  const variations = useMemo(
    () => getLatestPhaseVariations(experiment),
    [experiment],
  );

  const hasTableData = Boolean(contextualBanditSnapshot?.responses?.length);
  const attributes = contextualBanditSnapshot?.attributes ?? [];
  const responses = useMemo(
    () => contextualBanditSnapshot?.responses ?? [],
    [contextualBanditSnapshot?.responses],
  );
  const numVariations = variations.length;

  const responsesBySampleSize = useMemo(
    () =>
      [...responses].sort(
        (a, b) => contextTotalSampleSize(b) - contextTotalSampleSize(a),
      ),
    [responses],
  );

  const overallVariationWeights = useMemo(
    () => computeOverallVariationWeights(responses, numVariations),
    [responses, numVariations],
  );

  const totalUnits = useMemo(() => {
    const healthVariationUnits =
      snapshot?.health?.traffic?.overall?.variationUnits;
    if (healthVariationUnits && healthVariationUnits.length > 0) {
      return healthVariationUnits.reduce((acc, a) => acc + a, 0);
    }
    if (responses.length > 0) {
      return responses.reduce(
        (sum, row) => sum + contextTotalSampleSize(row),
        0,
      );
    }
    return 0;
  }, [snapshot?.health?.traffic?.overall?.variationUnits, responses]);

  const runResultsControl =
    canRunQueries && phase !== undefined ? (
      <RefreshResultsButton
        entityType={experiment.type === "holdout" ? "holdout" : "experiment"}
        entityId={experiment.id}
        datasourceId={experiment.datasource}
        latest={latest}
        experimentSnapshotTrackingProps={{
          trackingSource: "RunQueriesButton",
          datasourceType: datasource?.type || null,
        }}
        onSuccess={() => {
          setSnapshotType?.(undefined);
        }}
        mutate={mutateSnapshot}
        mutateAdditional={mutate}
        setRefreshError={setRefreshError}
        experiment={experiment}
        phase={phase}
        dimension={dimension}
        setAnalysisSettings={setAnalysisSettings}
      />
    ) : null;

  return (
    <Box>
      <Flex justify="end" align="center" mb="3" gap="4" wrap="wrap">
        {snapshot ? (
          <Metadata
            label={unitDisplayName}
            value={numberFormatter.format(totalUnits)}
            style={{ whiteSpace: "nowrap" }}
          />
        ) : null}
        <Flex align="center" gap="2">
          <QueriesLastRun
            status={status}
            dateCreated={snapshot?.dateCreated}
            latestQueryDate={latest?.dateCreated}
            nextUpdate={experiment.nextSnapshotAttempt}
            autoUpdateEnabled={
              experiment.autoSnapshots && !experiment.disableAutoSnapshots
            }
            showAutoUpdateWidget={true}
            failedString={
              latest && !latest.queries.length && latest.error
                ? `Snapshot update failed: ${latest.error}`
                : undefined
            }
            queries={
              latest &&
              (status === "failed" || status === "partially-succeeded")
                ? latest.queries.map((q) => q.query)
                : undefined
            }
            onViewQueries={
              latest &&
              (status === "failed" || status === "partially-succeeded")
                ? () => setQueriesModalOpen(true)
                : undefined
            }
          />
        </Flex>
        {runResultsControl}
        {datasource ? (
          <ResultMoreMenu
            experiment={experiment}
            datasource={datasource}
            forceRefresh={
              canRunQueries
                ? async () => {
                    await apiCall<{
                      snapshot: ExperimentSnapshotInterface;
                    }>(`/experiment/${experiment.id}/snapshot?force=true`, {
                      method: "POST",
                      body: JSON.stringify({
                        phase,
                        dimension,
                      }),
                    })
                      .then(() => {
                        mutateSnapshot();
                        mutate();
                        setRefreshError("");
                      })
                      .catch((e) => {
                        console.error(e);
                        setRefreshError(e.message);
                      });
                  }
                : undefined
            }
            notebookUrl={`/experiments/notebook/${snapshot?.id}`}
            notebookFilename={experiment.trackingKey}
            supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
            hasData={hasTableData}
            project={experiment.project}
          />
        ) : null}
      </Flex>
      {refreshError ? (
        <Callout status="error" mb="3">
          {refreshError}
        </Callout>
      ) : null}
      {!hasTableData ? (
        <CalloutLike>
          <Text size="medium" color="text-low">
            Contextual bandit results are not available for this snapshot yet.
            Run or refresh results to compute weights per context.
          </Text>
        </CalloutLike>
      ) : (
        <>
          <Table variant="list" className={styles.contextualBanditTable} mb="4">
            <ContextualBanditColGroup numVariations={numVariations} />
            <TableHeader>
              <TableRow>
                <TableColumnHeader />
                {variations.map((v) => (
                  <TableColumnHeader key={v.id} justify="end">
                    {v.name}
                  </TableColumnHeader>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <Text size="medium" weight="medium">
                    Overall weights
                  </Text>
                </TableCell>
                {(() => {
                  const intensities = rowHeatmapIntensities(
                    overallVariationWeights,
                  );
                  return overallVariationWeights.map((val, vi) => (
                    <HeatmapValueCell
                      key={vi}
                      value={val}
                      intensity={intensities[vi]}
                      mode="weights"
                    />
                  ));
                })()}
              </TableRow>
            </TableBody>
          </Table>
          <Flex justify="end" align="center" mb="2" gap="2">
            <Text size="medium" color="text-low">
              Weights
            </Text>
            <Switch
              value={mode === "means"}
              onChange={(checked) => setMode(checked ? "means" : "weights")}
              aria-label="Toggle variation means versus weights"
            />
            <Text size="medium" color="text-low">
              Means
            </Text>
          </Flex>
          <Table
            variant="list"
            stickyHeader
            className={styles.contextualBanditTable}
          >
            <ContextualBanditColGroup numVariations={numVariations} />
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Context</TableColumnHeader>
                {variations.map((v) => (
                  <TableColumnHeader key={v.id} justify="end">
                    {v.name}
                  </TableColumnHeader>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {responsesBySampleSize.map((row) => (
                <TableRow key={contextRowLabel(row, attributes)}>
                  <TableCell>
                    <Text size="medium">
                      {contextRowLabel(row, attributes)}
                    </Text>
                    {shouldShowUpdateMessage(row.updateMessage) ? (
                      <Text size="small" color="text-low" as="div" mt="1">
                        {row.updateMessage}
                      </Text>
                    ) : null}
                    {row.error ? (
                      <Box mt="1" style={{ color: "var(--red-11)" }}>
                        <Text size="small" as="div">
                          {row.error}
                        </Text>
                      </Box>
                    ) : null}
                  </TableCell>
                  {(() => {
                    const values = cellValues(row, mode, numVariations);
                    const intensities = rowHeatmapIntensities(values);
                    return values.map((val, vi) => (
                      <HeatmapValueCell
                        key={vi}
                        value={val}
                        intensity={intensities[vi]}
                        mode={mode}
                      />
                    ));
                  })()}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {queriesModalOpen &&
        latest &&
        (status === "failed" || status === "partially-succeeded") && (
          <AsyncQueriesModal
            close={() => setQueriesModalOpen(false)}
            queries={latest.queries.map((q) => q.query)}
            savedQueries={[]}
            error={latest.error}
          />
        )}
    </Box>
  );
}
