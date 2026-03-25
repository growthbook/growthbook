import * as React from "react";
import { Box, Flex } from "@radix-ui/themes";
import Tooltip from "@/ui/Tooltip";
import { RadixColor } from "./HelperText";
import styles from "./ProgressBar.module.scss";

export type Segment = {
  id: string;
  /**
   * The weight of the segment.
   *
   * The weight of the segment should be a number between 0 and 100.
   * If the weights do not sum to 100, a filler segment will be added to make up the difference.
   */
  weight: number;
  /**
   * The completion of the segment.
   *
   * The completion of the segment should be a number between 0 and 100.
   */
  completion: number;
  color: "slate" | RadixColor | "disabled";
  endBorder?: boolean;
  tooltip?: string;
};

type ProgressBarProps = {
  segments: Segment[];
};

export function ProgressBar({ segments }: ProgressBarProps) {
  const remainingWeight =
    100 - segments.reduce((acc, segment) => acc + segment.weight, 0);
  const segmentsWithFiller =
    remainingWeight > 0
      ? [
          ...segments,
          {
            id: "filler",
            weight: remainingWeight,
            completion: 0,
            color: "slate" as const,
          },
        ]
      : segments;
  return (
    <Flex
      className={styles.progressBarContainer}
      wrap="nowrap"
      height="24px"
      width="100%"
      style={{ height: "24px", borderRadius: "4px" }}
      overflow="hidden"
      my="4"
    >
      {segmentsWithFiller.map((segment, i) => {
        const completionPct = segment.completion;
        const remainingWidth = 100 - segment.completion;

        const inProgressColor =
          segment.color === "disabled"
            ? "var(--color-text-disabled)"
            : `var(--${segment.color}-a4)`;
        const completedColor =
          segment.color === "disabled"
            ? "var(--color-text-disabled)"
            : `var(--${segment.color}-9)`;

        const segmentStyle = {
          height: "24px",
          flex: `0 0 ${segment.weight}%`,
          minWidth: "0",
        };

        return (
          <Tooltip
            content={segment.tooltip}
            enabled={!!segment.tooltip}
            key={i}
          >
            <Flex
              key={segment.id}
              className={styles.segmentWrapper}
              wrap="nowrap"
              style={segmentStyle}
              flexShrink="0"
              overflow="hidden"
            >
              {completionPct > 0 && (
                <Box
                  height="100%"
                  style={{
                    width: `${completionPct}%`,
                    backgroundColor: completedColor,
                  }}
                  id={`${segment.id}-completed`}
                />
              )}
              {remainingWidth > 0 && (
                <Box
                  className={styles.progressBarStriped}
                  height="100%"
                  width={`${remainingWidth}%`}
                  style={{
                    backgroundColor:
                      i === segmentsWithFiller.length - 1 && remainingWeight > 0
                        ? "var(--slate-a2)"
                        : inProgressColor,
                    borderRight: segment.endBorder
                      ? `1px solid var(--${segment.color}-9)`
                      : "none",
                  }}
                  id={`${segment.id}-in-progress`}
                />
              )}
            </Flex>
          </Tooltip>
        );
      })}
    </Flex>
  );
}
