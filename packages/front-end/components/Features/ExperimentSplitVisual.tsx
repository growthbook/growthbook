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

/** How tall the connector is, and how it is put together. */
const CONNECTOR = {
  height: 22,
  /** The stem drops this far before the arms branch off it. */
  stem: 7,
  /** Rounded corner where an arm turns down toward its segment. */
  radius: 5,
  head: 3,
};

/**
 * A stem branching into one arrow per segment, each turning down over the
 * segment's midpoint. Drawn in pixels rather than percentages, so the corners
 * and heads keep their shape whatever the bar's width: the widths come in as
 * percentages, and the element measures itself to place them.
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

  const { height, stem, radius, head } = CONNECTOR;
  const midX = width / 2;
  const endY = height - head;

  // One path for every arm: they share a stem, and separate elements would
  // stack their alpha where they run together.
  const d = centers
    .map((center) => {
      const x = (center / 100) * width;
      const turn = Math.abs(x - midX) < radius;
      const dir = Math.sign(x - midX);
      const arm = turn
        ? `M ${midX} ${stem} L ${x} ${endY}`
        : `M ${midX} ${stem} L ${x - dir * radius} ${stem}` +
          ` Q ${x} ${stem}, ${x} ${stem + radius} L ${x} ${endY}`;
      return (
        arm +
        ` M ${x - head} ${endY - head} L ${x} ${endY} L ${x + head} ${endY - head}`
      );
    })
    .join(" ");

  return (
    <div ref={box} className={styles.connector}>
      {width > 0 ? (
        <svg width={width} height={height} aria-hidden>
          <path
            d={`M ${midX} 0 L ${midX} ${stem} ${d}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </div>
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
    <div
      className={clsx(
        styles.labels_row,
        slim && styles.labels_row_above,
        showConnector && styles.labels_row_connected,
      )}
    >
      {segments.map(({ i, left, width, name }) => (
        <span
          key={i}
          className={styles.segmentLabel}
          style={{ left: left + width / 2 + "%" }}
        >
          {parseFloat(width.toPrecision(4)) + "%"}
          {showValues && (
            <>
              {" "}
              - <strong>{name}</strong>
            </>
          )}
        </span>
      ))}
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
