import { Fragment, useMemo } from "react";
import clsx from "clsx";
import { Box, Flex } from "@radix-ui/themes";
import { NamespaceUsage } from "shared/types/organization";
import useOrgSettings from "@/hooks/useOrgSettings";
import { findGaps } from "@/services/features";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import {
  computeInUseIntervals,
  computeOverlapIntervals,
  mergeContiguousRanges,
  type RangeTuple,
} from "./NamespaceSelectorUtils";
import styles from "./NamespaceUsageGraph.module.scss";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const decimalFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});
const formatDecimal = (n: number) =>
  decimalFormatter.format(n).replace(/^0\./, ".");

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

  const gaps = useMemo(
    () => findGaps(usage, namespace, featureId, trackingKey),
    [usage, namespace, featureId, trackingKey],
  );
  const selectedRanges: RangeTuple[] = useMemo(
    () => ranges ?? (range ? [range] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(ranges), JSON.stringify(range)],
  );
  const inUseIntervals = useMemo(() => computeInUseIntervals(gaps), [gaps]);
  const overlapIntervals = useMemo(
    () =>
      mergeContiguousRanges(
        computeOverlapIntervals(selectedRanges, inUseIntervals),
      ),
    [selectedRanges, inUseIntervals],
  );
  const overlappingCount = useMemo(
    () =>
      ranges
        ? new Set(
            (usage[namespace] ?? [])
              .filter(
                (e) =>
                  e.id !== featureId &&
                  e.trackingKey !== trackingKey &&
                  selectedRanges.some(([rs, re]) => rs < e.end && e.start < re),
              )
              .map((e) => e.trackingKey || e.id),
          ).size
        : 0,
    [ranges, usage, namespace, featureId, trackingKey, selectedRanges],
  );

  if (!namespaces?.length) return null;

  const totalUsed = inUseIntervals.reduce((sum, [s, e]) => sum + (e - s), 0);
  const headerTotal = ranges
    ? ranges.reduce((sum, [s, e]) => sum + (e - s), 0)
    : totalUsed;

  const labeledSegments: RangeTuple[] =
    selectedRanges.length > 0 ? selectedRanges : inUseIntervals;

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
        {ranges && (
          <Flex align="center" gap="2">
            <Box className={clsx(styles.legend_box, styles.legend_active)} />
            <Text size="small" color="text-mid">
              Active
            </Text>
          </Flex>
        )}
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
                className={styles.inUse}
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
            {ranges &&
              overlapIntervals.map(([s, e], i) => (
                <div
                  key={`overlap-${i}`}
                  className={styles.overlapZone}
                  style={{ left: toPercent(s), width: toPercent(e - s) }}
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
              className={clsx(
                styles.segmentLabel,
                selectedRanges.length > 0 && styles.segmentLabelActive,
              )}
              style={{ left: toPercent((s + e) / 2) }}
            >
              {percentFormatter.format(e - s)}
            </span>
          ))}
          {selectedRanges.length > 0 &&
            selectedRanges.map(([s, e], i) => (
              <Fragment key={`gp-${i}`}>
                <span
                  className={styles.goalpostTick}
                  style={{ left: toPercent(s) }}
                >
                  |
                </span>
                <span
                  className={styles.goalpostTick}
                  style={{ left: toPercent(e) }}
                >
                  |
                </span>
                <span
                  className={styles.goalpostValue}
                  style={{ left: toPercent(s) }}
                >
                  {formatDecimal(s)}
                </span>
                <span
                  className={styles.goalpostValue}
                  style={{ left: toPercent(e) }}
                >
                  {formatDecimal(e)}
                </span>
              </Fragment>
            ))}
          {ranges &&
            (() => {
              const activeBoundaries = new Set(
                selectedRanges.flatMap(([s, e]) => [
                  +s.toFixed(4),
                  +e.toFixed(4),
                ]),
              );
              return overlapIntervals.flatMap(([s, e], i) =>
                [[s, `ol-s-${i}`] as const, [e, `ol-e-${i}`] as const]
                  .filter(([v]) => !activeBoundaries.has(+v.toFixed(4)))
                  .map(([v, key]) => (
                    <Fragment key={key}>
                      <span
                        className={styles.goalpostTickOverlap}
                        style={{ left: toPercent(v) }}
                      >
                        |
                      </span>
                      <span
                        className={styles.goalpostValueOverlap}
                        style={{ left: toPercent(v) }}
                      >
                        {formatDecimal(v)}
                      </span>
                    </Fragment>
                  )),
              );
            })()}
        </div>
      </Box>
      {overlappingCount > 0 && (
        <div className={styles.overlapWarning}>
          <HelperText status="warning" size="sm">
            Active range overlaps with {overlappingCount}{" "}
            {overlappingCount === 1 ? "experiment" : "experiments"}.
          </HelperText>
        </div>
      )}
    </Box>
  );
}
