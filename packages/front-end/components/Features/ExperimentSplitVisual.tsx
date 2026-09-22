import clsx from "clsx";
import React, {
  CSSProperties,
  Fragment,
  useEffect,
  useRef,
  useState,
} from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentValue, FeatureValueType } from "shared/types/feature";
import {
  getVariationColor,
  getVariationDefaultName,
} from "@/services/features";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import styles from "./ExperimentSplitVisual.module.scss";

/** How tall the connector is, where its horizontal run sits, and how softly
 * it turns onto and off that run. */
const CONNECTOR = { height: 20, bus: 10, radius: 6 };

/**
 * A stem dropping onto a horizontal run, which drops again over each segment's
 * midpoint. Drawn in pixels rather than percentages, so it keeps its shape
 * whatever the bar's width: the widths come in as percentages, and the element
 * measures itself to place them.
 */
function SegmentConnector({ centers }: { centers: number[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { height, bus, radius } = CONNECTOR;
  const midX = width / 2;

  // One path for the lot, arms and all: the stem is retraced by every arm, and
  // separate elements would stack their alpha where they overlap.
  const d = centers
    .map((center) => {
      const x = (center / 100) * width;
      const dx = x - midX;
      if (Math.abs(dx) < radius) return `M ${midX} 0 L ${x} ${height}`;
      const r = Math.sign(dx) * radius;
      return (
        `M ${midX} 0 L ${midX} ${bus - radius}` +
        ` Q ${midX} ${bus} ${midX + r} ${bus}` +
        ` L ${x - r} ${bus} Q ${x} ${bus} ${x} ${bus + radius}` +
        ` L ${x} ${height}`
      );
    })
    .join(" ");

  return (
    <div ref={box} className={styles.connector}>
      {width > 0 ? (
        <svg width={width} height={height} aria-hidden>
          <path d={d} fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      ) : null}
    </div>
  );
}

/**
 * The stem a percentage lands on its segment with, head and all in one shape:
 * a CSS line and an icon either side of it round to different pixels.
 * Proportioned to match the caret the funnel's other connectors end on.
 */
function SegmentStem() {
  return (
    <span className={styles.segmentStem}>
      <svg width="9" height="13" aria-hidden>
        <path
          d="M 4.5 0 V 11.5 M 1.1 8.1 L 4.5 11.5 L 7.9 8.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export interface Props {
  label?: string;
  unallocated?: string;
  coverage: number;
  values: ExperimentValue[];
  showValues?: boolean;
  type: FeatureValueType;
  stackLeft?: boolean;
  showPercentages?: boolean;
  /** A bare bar with its percentages above it, and no heading. */
  slim?: boolean;
  /**
   * Draw a connector above the labels, branching from a single stem into an
   * arrow per segment. Slim mode only, where the labels sit on top.
   */
  connector?: boolean;
  /** Makes each percentage a button, for editing that variation's share. */
  onSegmentClick?: (index: number) => void;
}
export default function ExperimentSplitVisual({
  label = "Traffic split preview",
  unallocated = "Not included",
  coverage,
  values,
  showValues = false,
  type,
  stackLeft = false,
  showPercentages = true,
  slim = false,
  connector = false,
  onSegmentClick,
}: Props) {
  const totalWeights = parseFloat(
    values.reduce((partialSum, v) => partialSum + v.weight, 0).toFixed(3),
  );

  const coverageVal = coverage ? coverage : 0;
  const showConnector = connector && slim && showPercentages;

  // Geometry shared by the bar and the label row beneath it. A segment's left
  // edge is the running total of the raw weights in both modes: a stacked
  // segment plus its gap spans weight * coverage + weight * (1 - coverage).
  let runningLeft = 0;
  const segments = values.map((val, i) => {
    const left = runningLeft;
    runningLeft += 100 * val.weight;
    const width = val.weight && coverage ? val.weight * coverage * 100 : 0;
    return {
      i,
      left,
      width,
      gap: val.weight && coverage < 1 ? val.weight * (1 - coverage) * 100 : 0,
      name: getVariationDefaultName(val, type),
    };
  });

  const labelsRow = showPercentages ? (
    <div className={clsx(styles.labels_row, slim && styles.labels_row_above)}>
      {segments.map(({ i, left, width, name }) => {
        const contents = (
          <>
            {parseFloat(width.toPrecision(4)) + "%"}
            {showValues && (
              <>
                {" "}
                - <strong>{name}</strong>
              </>
            )}
            {showConnector ? <SegmentStem /> : null}
          </>
        );
        const style = {
          left: left + width / 2 + "%",
          ...(showConnector ? { borderColor: getVariationColor(i, true) } : {}),
        };

        return onSegmentClick ? (
          <button
            key={i}
            type="button"
            className={clsx(styles.segmentLabel, styles.segmentLabel_button)}
            style={style}
            onClick={() => onSegmentClick(i)}
            aria-label={`Edit ${name}'s share of the split`}
          >
            {contents}
          </button>
        ) : (
          <span key={i} className={styles.segmentLabel} style={style}>
            {contents}
          </span>
        );
      })}
    </div>
  ) : null;

  return (
    <Box>
      {totalWeights !== 1 ? (
        <Callout status="error" size="sm" mb="3">
          Please adjust weights to sum to 100%.
        </Callout>
      ) : null}
      {slim ? null : (
        <Flex align="center" gap="4">
          <Box flexGrow="1">
            <Text size="md" weight="medium">
              {label}
            </Text>{" "}
            <Text as="span" size="md" color="text-low">
              ({percentFormatter.format(coverageVal)} included)
            </Text>
          </Box>
          {coverage < 1 && (
            <Flex align="center" gap="2">
              <Box className={styles.legend_box} />
              <Text size="sm" color="text-mid">
                {unallocated}
              </Text>
            </Flex>
          )}
        </Flex>
      )}
      <Box className={styles.bar_wrapper}>
        {showConnector ? (
          <SegmentConnector
            centers={segments.map(({ left, width }) => left + width / 2)}
          />
        ) : null}
        {slim ? labelsRow : null}
        <div className={clsx(slim && styles.bar_clip)}>
          <div
            className={clsx(
              styles.bar_holder,
              slim && styles.bar_holder_slim,
              "d-flex flex-row",
            )}
          >
            {segments.map(({ i, left, width, gap, name }) => {
              const additionalStyles: CSSProperties = {
                width: width + "%",
                backgroundColor: getVariationColor(i, true),
              };
              if (!stackLeft) {
                additionalStyles.position = "absolute";
                additionalStyles.left = left + "%";
              }

              return (
                <Fragment key={i}>
                  <div className={styles.previewBar} style={additionalStyles}>
                    <Tooltip
                      body={`${name} (${parseFloat(width.toPrecision(5))}%)`}
                      style={{ width: "100%", height: "100%" }}
                    >
                      <></>
                    </Tooltip>
                  </div>
                  {stackLeft && gap > 0 && (
                    <div className={styles.gapBar} style={{ width: gap + "%" }}>
                      <Tooltip
                        body={`Not included: ${parseFloat(gap.toPrecision(5))}%`}
                        style={{ width: "100%", height: "100%" }}
                      >
                        <></>
                      </Tooltip>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
        {slim ? null : labelsRow}
      </Box>
    </Box>
  );
}
