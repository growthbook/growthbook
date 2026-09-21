import clsx from "clsx";
import React, { CSSProperties, Fragment } from "react";
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
}: Props) {
  const totalWeights = parseFloat(
    values.reduce((partialSum, v) => partialSum + v.weight, 0).toFixed(3),
  );

  const coverageVal = coverage ? coverage : 0;

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

  return (
    <Box>
      {totalWeights !== 1 ? (
        <Callout status="error" size="sm" mb="3">
          Please adjust weights to sum to 100%.
        </Callout>
      ) : null}
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
      <Box className={styles.bar_wrapper}>
        <div className={clsx(styles.bar_holder, "d-flex flex-row")}>
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
        {showPercentages && (
          <div className={styles.labels_row}>
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
        )}
      </Box>
    </Box>
  );
}
