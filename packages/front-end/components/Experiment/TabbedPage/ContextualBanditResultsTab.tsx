import { FC } from "react";
import {
  ContextualBanditEventInterface,
  ContextualBanditSnapshotInterface,
  LeafWeight,
} from "shared/validators";
import { date } from "shared/dates";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/ui/Tabs";

type CurrentResponse = {
  currentLeafWeights: LeafWeight[];
  latestEvent: ContextualBanditEventInterface | null;
};

function getConditionLabel(leaf: LeafWeight) {
  if (leaf.contextId === "other") return "Other";
  if (!Object.keys(leaf.condition).length) return "All users";
  return JSON.stringify(leaf.condition);
}

/** Interpolate between two hex colors at position t ∈ [0, 1]. */
function lerpColor(a: string, b: string, t: number): string {
  const ah = parseInt(a.replace("#", ""), 16);
  const bh = parseInt(b.replace("#", ""), 16);
  const ar = (ah >> 16) & 0xff;
  const ag = (ah >> 8) & 0xff;
  const ab = ah & 0xff;
  const br = (bh >> 16) & 0xff;
  const bg = (bh >> 8) & 0xff;
  const bb = bh & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const b2 = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${b2})`;
}

const HEATMAP_LOW = "#dbeafe"; // cool blue
const HEATMAP_MID = "#fef9c3"; // warm yellow
const HEATMAP_HIGH = "#ef4444"; // red

function heatmapColor(t: number): string {
  // t ∈ [0,1]: 0→low (blue), 0.5→mid (yellow), 1→high (red)
  if (t <= 0.5) return lerpColor(HEATMAP_LOW, HEATMAP_MID, t * 2);
  return lerpColor(HEATMAP_MID, HEATMAP_HIGH, (t - 0.5) * 2);
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

interface HeatmapProps {
  rowLabels: string[];
  colLabels: string[];
  /** values[row][col] */
  values: (number | null)[][];
  formatValue: (v: number) => string;
}

function HeatmapGrid({ rowLabels, colLabels, values, formatValue }: HeatmapProps) {
  const allValues = values
    .flat()
    .filter((v): v is number => v !== null && !isNaN(v));
  const min = allValues.length ? Math.min(...allValues) : 0;
  const max = allValues.length ? Math.max(...allValues) : 1;

  const LABEL_COL_WIDTH = "minmax(120px, 1fr)";
  const DATA_COL_WIDTH = "minmax(80px, 1fr)";

  return (
    <Box style={{ overflowX: "auto" }}>
      <Grid
        style={{
          gridTemplateColumns: `${LABEL_COL_WIDTH} ${colLabels.map(() => DATA_COL_WIDTH).join(" ")}`,
          gap: 1,
          minWidth: 300,
        }}
      >
        {/* Header row */}
        <Box
          py="2"
          px="3"
          style={{
            fontWeight: 600,
            fontSize: 12,
            color: "var(--gray-11)",
            backgroundColor: "var(--gray-2)",
            borderRadius: "6px 0 0 0",
          }}
        >
          Context
        </Box>
        {colLabels.map((col, ci) => (
          <Box
            key={ci}
            py="2"
            px="2"
            style={{
              fontWeight: 600,
              fontSize: 12,
              textAlign: "center",
              backgroundColor: "var(--gray-2)",
              color: "var(--gray-11)",
              borderRadius: ci === colLabels.length - 1 ? "0 6px 0 0" : 0,
              wordBreak: "break-word",
            }}
          >
            {col}
          </Box>
        ))}

        {/* Data rows */}
        {rowLabels.map((row, ri) => (
          <>
            <Box
              key={`label-${ri}`}
              py="2"
              px="3"
              style={{
                fontSize: 12,
                color: "var(--gray-12)",
                backgroundColor: "var(--gray-1)",
                borderTop: "1px solid var(--gray-a4)",
                fontFamily: "var(--font-family-mono, monospace)",
                wordBreak: "break-all",
                display: "flex",
                alignItems: "center",
              }}
            >
              {row}
            </Box>
            {colLabels.map((_, ci) => {
              const v = values[ri]?.[ci] ?? null;
              const t = v !== null && !isNaN(v) ? normalize(v, min, max) : null;
              const bg = t !== null ? heatmapColor(t) : "var(--gray-3)";
              const textColor =
                t !== null && t > 0.7 ? "#fff" : "var(--gray-12)";
              return (
                <Box
                  key={`cell-${ri}-${ci}`}
                  py="2"
                  px="2"
                  style={{
                    backgroundColor: bg,
                    borderTop: "1px solid var(--gray-a4)",
                    textAlign: "center",
                    fontSize: 13,
                    fontWeight: 500,
                    color: textColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {v !== null ? formatValue(v) : "—"}
                </Box>
              );
            })}
          </>
        ))}
      </Grid>

      {/* Color scale legend */}
      <Flex align="center" gap="2" mt="3" style={{ fontSize: 11, color: "var(--gray-10)" }}>
        <Text size="small" color="text-low">Low</Text>
        <Box
          style={{
            height: 10,
            width: 120,
            borderRadius: 4,
            background: `linear-gradient(to right, ${HEATMAP_LOW}, ${HEATMAP_MID}, ${HEATMAP_HIGH})`,
          }}
        />
        <Text size="small" color="text-low">High</Text>
      </Flex>
    </Box>
  );
}

export const ContextualBanditResultsTab: FC<{
  experiment: ExperimentInterfaceStringDates;
}> = ({ experiment }) => {
  const { apiCall } = useAuth();
  const current = useApi<CurrentResponse>(
    `/experiment/${experiment.id}/contextual-bandit/current`,
  );
  const snapshots = useApi<{ snapshots: ContextualBanditSnapshotInterface[] }>(
    `/experiment/${experiment.id}/contextual-bandit/snapshots?limit=10`,
    { refreshInterval: 5000 },
  );
  const latestSnapshot = snapshots.data?.snapshots[0];
  const refreshDisabled = latestSnapshot?.status === "running";
  const currentData = current.data;

  const refresh = async () => {
    await apiCall(`/experiment/${experiment.id}/contextual-bandit/refresh`, {
      method: "POST",
    });
    await Promise.all([current.mutate(), snapshots.mutate()]);
  };

  if (current.error) {
    return (
      <Callout status="error">
        Failed to load contextual bandit results: {current.error.message}
      </Callout>
    );
  }

  // Derive heatmap dimensions when data is available
  const colLabels = experiment.variations.map((v) => v.name);

  const weightsMatrix: (number | null)[][] = [];
  const goalMetricMatrix: (number | null)[][] = [];
  const rowLabels: string[] = [];

  if (currentData && currentData.currentLeafWeights.length > 0) {
    for (const leaf of currentData.currentLeafWeights) {
      rowLabels.push(getConditionLabel(leaf));

      // Weights row
      const weightRow = leaf.weights.map((w) => w);
      weightsMatrix.push(weightRow);

      // Goal metric (posteriorMean) row
      const contextResult = currentData.latestEvent?.contextResults.find(
        (ctx) => ctx.contextId === leaf.contextId,
      );
      const goalRow = colLabels.map((_, ci) => {
        const pm = contextResult?.variations[ci]?.posteriorMean;
        return pm !== undefined ? pm : null;
      });
      goalMetricMatrix.push(goalRow);
    }
  }

  const decisionMetric = currentData?.latestEvent?.decisionMetric ?? "Goal metric";

  return (
    <Box>
      <Flex align="center" justify="between" mb="3">
        <Box>
          <Text size="x-large" weight="medium">
            Contextual Bandit Results
          </Text>
          <Text as="div" size="medium" color="text-low">
            Policy weights and goal metric by context and variation.
          </Text>
        </Box>
        <Button onClick={refresh} disabled={refreshDisabled}>
          {refreshDisabled ? "Refresh running" : "Refresh now"}
        </Button>
      </Flex>

      {!currentData ? (
        <LoadingSpinner />
      ) : currentData.currentLeafWeights.length === 0 ? (
        <Callout status="info">
          No contextual bandit weights have been generated yet. Click Refresh
          now to run the first snapshot.
        </Callout>
      ) : (
        <Tabs defaultValue="weights">
          <TabsList mb="3">
            <TabsTrigger value="weights">Weights</TabsTrigger>
            <TabsTrigger value="goal-metric">{decisionMetric}</TabsTrigger>
          </TabsList>

          <TabsContent value="weights">
            <Text as="div" size="small" color="text-low" mb="2">
              Allocation weight assigned to each variation per context (leaf
              rule). Weights within a context sum to 1.
            </Text>
            <HeatmapGrid
              rowLabels={rowLabels}
              colLabels={colLabels}
              values={weightsMatrix}
              formatValue={(v) => `${(v * 100).toFixed(1)}%`}
            />
          </TabsContent>

          <TabsContent value="goal-metric">
            <Text as="div" size="small" color="text-low" mb="2">
              Posterior mean of <strong>{decisionMetric}</strong> for each
              variation per context, as estimated by the latest tick.
            </Text>
            <HeatmapGrid
              rowLabels={rowLabels}
              colLabels={colLabels}
              values={goalMetricMatrix}
              formatValue={(v) => v.toFixed(3)}
            />
          </TabsContent>
        </Tabs>
      )}

      <Flex gap="2" align="center" wrap="wrap" mt="4">
        <Text size="medium" weight="medium">
          Snapshot history
        </Text>
        {snapshots.data?.snapshots.length ? (
          snapshots.data.snapshots.map((snapshot) => (
            <Tooltip
              key={snapshot.id}
              body={
                snapshot.error
                  ? snapshot.error
                  : snapshot.weightsWereUpdated
                    ? "Weights updated"
                    : "Weights unchanged"
              }
            >
              <Box
                px="2"
                py="1"
                style={{
                  border: "1px solid var(--gray-a6)",
                  borderRadius: 4,
                }}
              >
                <Text size="small">
                  {date(snapshot.dateCreated)} · {snapshot.status}
                  {snapshot.weightsWereUpdated ? " · updated" : ""}
                </Text>
              </Box>
            </Tooltip>
          ))
        ) : (
          <Text size="medium" color="text-low">
            No snapshots yet
          </Text>
        )}
      </Flex>
    </Box>
  );
};
