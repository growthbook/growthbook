// TODO(holdout-v1.5): attach holdout-vs-bandit comparison view and EDF recommendations here.
import { useMemo, useState, type CSSProperties } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { startCase } from "lodash";
import { ApiContextualBanditInterface } from "shared/validators";
import type { ContextualBanditResponseSnapshot } from "shared/types/stats";
import { ATTR_CB_PREFIX } from "shared/constants";
import { expandMetricGroups } from "shared/experiments";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import Callout from "@/ui/Callout";
import Metadata from "@/ui/Metadata";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useContextualBanditResults } from "@/hooks/useContextualBandits";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
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
      ? row.sampleMeans
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

/**
 * CB-native results table. Consumes the CB API shape and the CB results context directly —
 * no experiment SnapshotProvider, no phases, no experiment-shaped adapter.
 */
export default function ContextualBanditResultsTable({
  cb,
  mutate,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
}) {
  const [mode, setMode] = useState<"weights" | "means">("weights");
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);
  const { getDatasourceById, metricGroups } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const {
    contextualBanditSnapshot,
    latest,
    refresh,
    refreshing,
    refreshError,
  } = useContextualBanditResults(cb.id);

  const datasource = cb.datasource ? getDatasourceById(cb.datasource) : null;
  const { contextualBanditQueriesMap } = useContextualBanditQueries(
    cb.datasource,
  );
  const userIdType = contextualBanditQueriesMap.get(
    cb.contextualBanditQueryId,
  )?.userIdType;
  const unitDisplayName = userIdType
    ? startCase(userIdType.split("_").join(" ")) + "s"
    : "Units";

  const queryLatest = latest;
  const { status } = getQueryStatus(
    queryLatest?.queries || [],
    queryLatest?.error,
  );

  const allExpandedMetrics = useMemo(() => {
    const ids = cb.decisionMetric ? [cb.decisionMetric] : [];
    if (cb.activationMetric) ids.push(cb.activationMetric);
    return Array.from(new Set(expandMetricGroups(ids, metricGroups)));
  }, [cb.decisionMetric, cb.activationMetric, metricGroups]);

  const canRunQueries =
    !!datasource &&
    permissionsUtil.canRunExperimentQueries(datasource) &&
    allExpandedMetrics.length > 0;

  const variations = cb.variations;
  const numVariations = variations.length;

  const hasTableData = Boolean(contextualBanditSnapshot?.responses?.length);
  const attributes = contextualBanditSnapshot?.attributes ?? [];
  const responses = useMemo(
    () => contextualBanditSnapshot?.responses ?? [],
    [contextualBanditSnapshot?.responses],
  );

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

  const totalUnits = useMemo(
    () => responses.reduce((sum, row) => sum + contextTotalSampleSize(row), 0),
    [responses],
  );

  const showQueries =
    !!queryLatest && (status === "failed" || status === "partially-succeeded");

  return (
    <Box>
      <Flex justify="end" align="center" mb="3" gap="4" wrap="wrap">
        {contextualBanditSnapshot ? (
          <Metadata
            label={unitDisplayName}
            value={numberFormatter.format(totalUnits)}
            style={{ whiteSpace: "nowrap" }}
          />
        ) : null}
        <Flex align="center" gap="2">
          <QueriesLastRun
            status={status}
            dateCreated={queryLatest?.dateCreated}
            latestQueryDate={queryLatest?.dateCreated}
            nextUpdate={undefined}
            autoUpdateEnabled={false}
            showAutoUpdateWidget={false}
            failedString={
              queryLatest && !queryLatest.queries.length && queryLatest.error
                ? `Snapshot update failed: ${queryLatest.error}`
                : undefined
            }
            queries={
              showQueries ? queryLatest.queries.map((q) => q.query) : undefined
            }
            onViewQueries={
              showQueries ? () => setQueriesModalOpen(true) : undefined
            }
          />
        </Flex>
        {canRunQueries ? (
          <Button
            loading={refreshing}
            onClick={async () => {
              await refresh();
              mutate();
            }}
          >
            Update results
          </Button>
        ) : null}
        <ResultMoreMenu
          datasource={datasource}
          project={cb.project}
          hasData={hasTableData}
          legacyQueries={queryLatest?.queries ?? []}
          legacyQueryError={queryLatest?.error}
          forceRefresh={
            canRunQueries
              ? async () => {
                  await refresh();
                  mutate();
                }
              : undefined
          }
          notebookUrl=""
          notebookFilename={cb.trackingKey}
          supportsNotebooks={false}
        />
      </Flex>
      {refreshError ? (
        <Callout status="error" mb="3">
          {refreshError}
        </Callout>
      ) : null}
      {!hasTableData ? (
        <Callout status="info">
          Contextual bandit results are not available for this snapshot yet. Run
          or refresh results to compute weights per context.
        </Callout>
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
      {queriesModalOpen && showQueries && (
        <AsyncQueriesModal
          close={() => setQueriesModalOpen(false)}
          queries={queryLatest.queries.map((q) => q.query)}
          savedQueries={[]}
          error={queryLatest.error}
        />
      )}
    </Box>
  );
}
