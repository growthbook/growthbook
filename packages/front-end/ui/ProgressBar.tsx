import * as React from "react";
import { Box, Flex } from "@radix-ui/themes";
import Tooltip from "@/ui/Tooltip";
import { RadixColor } from "./HelperText";

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
      wrap="nowrap"
      className="h-2 w-full rounded-full bg-gray-200"
      style={{ height: "24px", borderRadius: "4px" }}
      overflow="hidden"
      my="4"
    >
      {segmentsWithFiller.map((segment, i) => {
        const isFirst = i === 0;
        const isLast = i === segmentsWithFiller.length - 1;
        const completionPct = segment.completion / 100;
        const completedWidth = completionPct * 100;
        const remainingWidth = 100 - completedWidth;

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
              key={i}
              wrap="nowrap"
              className="shrink-0 transition-all"
              style={segmentStyle}
              overflow="hidden"
            >
              {completedWidth > 0 && (
                <Box
                  className="h-full transition-all"
                  style={{
                    width: `${completedWidth}%`,
                    borderRadius:
                      remainingWidth === 0
                        ? isFirst && isLast
                          ? "4px"
                          : isFirst
                            ? "4px 0 0 4px"
                            : isLast
                              ? "0 4px 4px 0"
                              : "0"
                        : isFirst
                          ? "4px 0 0 4px"
                          : "0",
                    backgroundColor: completedColor,
                  }}
                  id={`${segment.id}-completed`}
                />
              )}
              {remainingWidth > 0 && (
                <Box
                  className="h-full progress-bar-striped transition-all"
                  style={{
                    width: `${remainingWidth}%`,
                    borderRadius:
                      completedWidth === 0
                        ? isFirst && isLast
                          ? "4px"
                          : isFirst
                            ? "4px 0 0 4px"
                            : isLast
                              ? "0 4px 4px 0"
                              : "0"
                        : isLast
                          ? "0 4px 4px 0"
                          : "0",
                    backgroundColor:
                      isLast && remainingWeight > 0
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
