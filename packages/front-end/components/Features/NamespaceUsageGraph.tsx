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

// Intervals within `parents` that are NOT covered by any of `subtract`.
function subtractIntervals(
  parents: Interval[],
  subtract: Interval[],
): Interval[] {
  const result: Interval[] = [];
  for (const [pStart, pEnd] of parents) {
    const overlaps = subtract
      .filter(([s, e]) => e > pStart && s < pEnd)
      .map<Interval>(([s, e]) => [Math.max(s, pStart), Math.min(e, pEnd)])
      .sort((a, b) => a[0] - b[0]);
    let cursor = pStart;
    for (const [s, e] of overlaps) {
      if (cursor < s) result.push([cursor, s]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < pEnd) result.push([cursor, pEnd]);
  }
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
  setRange,
  title = "Allocation",
}: Props) {
  const { namespaces } = useOrgSettings();

  if (!namespaces?.length) return null;

  const gaps = findGaps(usage, namespace, featureId, trackingKey);
  const selectedRanges: Interval[] = ranges ?? (range ? [range] : []);
  const inUseIntervals = computeInUseIntervals(gaps);
  const otherInUse = subtractIntervals(inUseIntervals, selectedRanges);
  const totalUsed = inUseIntervals.reduce((sum, [s, e]) => sum + (e - s), 0);
  // In edit mode (`ranges` prop passed) the header shows the caller's selected
  // sum — mirrors NamespaceSelector's existing "Total:" badge computation so
  // the two numbers stay in sync. Otherwise show the namespace's total in-use.
  const headerTotal = ranges
    ? ranges.reduce((sum, [s, e]) => sum + (e - s), 0)
    : totalUsed;

  const labeledSegments: Interval[] = [...selectedRanges, ...otherInUse];

  return (
    <Box className={styles.card}>
      <Flex align="center" gap="3" mb="1">
        <Box flexGrow="1">
          <Text as="label" size="medium" weight="medium">
            {title}
          </Text>{" "}
          <Text as="span" size="medium" color="text-low">
            ({percentFormatter.format(headerTotal)} total)
          </Text>
        </Box>
        <Flex align="center" gap="1">
          <Box className={clsx(styles.legend_box, styles.used)} />
          <Text size="small" color="text-low">
            In use
          </Text>
        </Flex>
        <Flex align="center" gap="1">
          <Box className={clsx(styles.legend_box, styles.unused)} />
          <Text size="small" color="text-low">
            Available
          </Text>
        </Flex>
        {(ranges?.length || range) && (
          <Flex align="center" gap="1">
            <Box className={clsx(styles.legend_box, styles.selected)} />
            <Text size="small" color="text-low">
              Selected
            </Text>
          </Flex>
        )}
      </Flex>
      <Box className={styles.bar_wrapper}>
        <div className={styles.bar_holder}>
          {otherInUse.map(([s, e], i) => (
            <div
              key={`other-${i}`}
              className={styles.otherInUse}
              style={{
                left: toPercent(s),
                width: toPercent(e - s),
              }}
            />
          ))}
          {gaps.map((g, i) => (
            <div
              key={`gap${i}`}
              className={clsx(styles.bar, styles.barUnused)}
              style={{
                left: toPercent(g.start),
                width: toPercent(g.end - g.start),
                cursor: setRange ? "pointer" : "default",
              }}
              onClick={(e) => {
                e.preventDefault();
                if (setRange) {
                  setRange([g.start, g.end]);
                }
              }}
            />
          ))}
          {selectedRanges.map((r, i) => (
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
