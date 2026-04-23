import clsx from "clsx";
import { Box, Flex } from "@radix-ui/themes";
import { NamespaceUsage } from "shared/types/organization";
import useOrgSettings from "@/hooks/useOrgSettings";
import { findGaps } from "@/services/features";
import Text from "@/ui/Text";
import styles from "./NamespaceUsageGraph.module.scss";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export interface Props {
  usage: NamespaceUsage;
  namespace: string;
  featureId?: string;
  trackingKey?: string;
  range?: [number, number];
  ranges?: [number, number][];
  focusedRangeIndex?: number | null;
  setRange?: (range: [number, number]) => void;
  title?: string;
}

type Interval = [number, number];

// Complement of `gaps` within [0, 1] — i.e. intervals that are in-use.
function computeInUseIntervals(
  gaps: { start: number; end: number }[],
): Interval[] {
  const sorted = [...gaps].sort((a, b) => a.start - b.start);
  const result: Interval[] = [];
  let cursor = 0;
  for (const g of sorted) {
    if (cursor < g.start) result.push([cursor, g.start]);
    cursor = Math.max(cursor, g.end);
  }
  if (cursor < 1) result.push([cursor, 1]);
  return result;
}

const toPercent = (n: number) => `${+(n * 100).toFixed(4)}%`;

export default function NamespaceUsageGraph({
  usage,
  namespace,
  featureId = "",
  trackingKey = "",
  range,
  ranges,
  focusedRangeIndex = null,
  setRange,
  title = "Allocation",
}: Props) {
  const { namespaces } = useOrgSettings();

  if (!namespaces?.length) return null;

  const gaps = findGaps(usage, namespace, featureId, trackingKey);
  const selectedRanges: Interval[] = ranges ?? (range ? [range] : []);
  const inUseIntervals = computeInUseIntervals(gaps);
  const totalUsed = inUseIntervals.reduce((sum, [s, e]) => sum + (e - s), 0);
  // Edit mode: show caller's selected sum; otherwise show namespace total.
  const headerTotal = ranges
    ? ranges.reduce((sum, [s, e]) => sum + (e - s), 0)
    : totalUsed;

  const isActive = (s: number, e: number) =>
    selectedRanges.some(([rs, re]) => s < re && rs < e);

  const labeledSegments: Interval[] = ranges ? selectedRanges : inUseIntervals;

  return (
    <Box className={styles.card}>
      <Flex align="center" gap="4" mb="1">
        <Box flexGrow="1">
          <Text as="label" size="medium" weight="medium">
            {title}
          </Text>{" "}
          <Text as="span" size="medium" color="text-low">
            ({percentFormatter.format(headerTotal)} total)
          </Text>
        </Box>
        <Flex align="center" gap="2">
          <Box className={clsx(styles.legend_box, styles.legend_available)} />
          <Text size="small" color="text-mid">
            Available
          </Text>
        </Flex>
        <Flex align="center" gap="2">
          <Box className={clsx(styles.legend_box, styles.legend_inUse)} />
          <Text size="small" color="text-mid">
            In use
          </Text>
        </Flex>
      </Flex>
      <Box className={styles.bar_wrapper}>
        <div className={styles.bar_inner}>
          <div className={styles.bar_holder}>
            {inUseIntervals.map(([s, e], i) => (
              <div
                key={`inuse-${i}`}
                className={clsx(
                  styles.inUse,
                  isActive(s, e) && styles.inUseActive,
                )}
                style={{ left: toPercent(s), width: toPercent(e - s) }}
              />
            ))}
            {setRange &&
              gaps.map((g, i) => (
                <div
                  key={`gap${i}`}
                  className={styles.gapClickTarget}
                  style={{
                    left: toPercent(g.start),
                    width: toPercent(g.end - g.start),
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    setRange([g.start, g.end]);
                  }}
                />
              ))}
            {ranges &&
              selectedRanges.map((r, i) => (
                <div
                  key={`range-${i}`}
                  className={styles.rangeSelected}
                  style={{
                    left: toPercent(r[0]),
                    width: toPercent(r[1] - r[0]),
                  }}
                />
              ))}
          </div>
          {focusedRangeIndex !== null && selectedRanges[focusedRangeIndex] && (
            <div
              className={styles.rangeFocusedOverlay}
              style={{
                left: toPercent(selectedRanges[focusedRangeIndex][0]),
                width: toPercent(
                  selectedRanges[focusedRangeIndex][1] -
                    selectedRanges[focusedRangeIndex][0],
                ),
              }}
            />
          )}
        </div>
        <div className={styles.labels_row}>
          {labeledSegments.map(([s, e], i) => (
            <span
              key={`label-${i}`}
              className={styles.segmentLabel}
              style={{ left: toPercent(s) }}
            >
              {percentFormatter.format(e - s)}
            </span>
          ))}
        </div>
      </Box>
    </Box>
  );
}
