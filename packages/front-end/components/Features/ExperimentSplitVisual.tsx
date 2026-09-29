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

// px: total height, the horizontal run's y, and its corner radius.
const CONNECTOR = { height: 20, bus: 10, radius: 6 };

/**
 * A stem branching into one arm per segment midpoint. Drawn in measured pixels
 * rather than percentages so the corners keep their shape at any bar width.
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

  // One path: every arm retraces the stem, so separate paths would stack alpha.
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

// Stem and arrowhead in one path: a CSS line beside an icon rounds to
// different pixels.
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
  /** Slim only: a connector branching from one stem into an arrow per label. */
  connector?: boolean;
  /** Slim only: px the segments reach past the bar's clipped ends. */
  overhang?: number;
  /** Slim only: px the visible bar reaches past what it sits over. */
  bleed?: number;
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
  overhang = 0,
  bleed = 0,
  onSegmentClick,
}: Props) {
  const totalWeights = parseFloat(
    values.reduce((partialSum, v) => partialSum + v.weight, 0).toFixed(3),
  );

  const coverageVal = coverage ? coverage : 0;
  const reach = slim ? overhang : 0;
  // How far in from the segments' ends the visible bar is clipped.
  const inset = slim ? overhang - bleed : 0;
  const showConnector = connector && slim && showPercentages;

  // A segment's left edge is the running total of raw weights in both modes: a
  // stacked segment plus its gap spans the whole weight.
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
      <Box
        className={styles.bar_wrapper}
        style={reach ? { marginLeft: -reach, marginRight: -reach } : undefined}
      >
        {showConnector ? (
          <SegmentConnector
            centers={segments.map(({ left, width }) => left + width / 2)}
          />
        ) : null}
        {slim ? labelsRow : null}
        <div
          className={clsx(slim && styles.bar_clip)}
          style={inset ? { margin: `0 ${inset}px` } : undefined}
        >
          <div
            className={clsx(
              styles.bar_holder,
              slim && styles.bar_holder_slim,
              "d-flex flex-row",
            )}
            style={inset ? { margin: `0 ${-inset}px` } : undefined}
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
