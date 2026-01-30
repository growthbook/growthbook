import * as React from "react";
import clsx from "clsx";
import { Box, Flex } from "@radix-ui/themes";
import styles from "@/components/Features/ExperimentSplitVisual.module.scss";

type Segment = {
  id: string;
  name: string;
  weight: number; // 0-1, segment weights should sum to 1
  completion: number; // 0-1, completion of the segment
  color: string;
};

type ProgressBarProps = {
  segments?: Segment[];
  height?: number;
  radius?: number;
  className?: string;
};

export function ProgressBar({
  segments = [],
  height = 8,
  radius = 4,
  className,
}: ProgressBarProps) {
  const testSegments = [
    {
      id: "1",
      name: "Segment 1",
      weight: 60,
      completion: 100,
      color: "indigo",
    },
    {
      id: "2",
      name: "Segment 2",
      weight: 40,
      completion: 10,
      color: "amber",
    },
  ];

  const firstSegment = testSegments[0];
  const firstCompletionPct =
    firstSegment &&
    (firstSegment.completion <= 1
      ? firstSegment.completion
      : firstSegment.completion / 100);
  const isFirstSegmentComplete =
    firstSegment != null && firstCompletionPct >= 1;

  return (
    <Flex
      wrap="nowrap"
      className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
      style={{ height: "24px", borderRadius: "4px" }}
      my="4"
    >
      {!isFirstSegmentComplete && firstSegment ? (
        <>
          {firstCompletionPct > 0 && (
            <Box
              className="h-full shrink-0 transition-all"
              style={{
                height: "24px",
                flex: `0 0 ${firstSegment.weight * firstCompletionPct}%`,
                minWidth: 0,
                borderRadius: "4px 0 0 4px",
                backgroundColor: `var(--${firstSegment.color}-9)`,
              }}
            />
          )}
          {1 - firstCompletionPct > 0 && (
            <Box
              className="h-full shrink-0 progress-bar-striped transition-all"
              style={{
                height: "24px",
                flex: `0 0 ${firstSegment.weight * (1 - firstCompletionPct)}%`,
                minWidth: 0,
                borderRadius: testSegments.length === 1 ? "0 4px 4px 0" : "0",
                backgroundColor: `var(--${firstSegment.color}-a4)`,
              }}
            />
          )}
          {testSegments.length > 1 && (
            <Box
              className="h-full min-w-0 flex-1 progress-bar-striped transition-all"
              style={{
                height: "24px",
                borderRadius: "0 4px 4px 0",
                backgroundColor: "var(--slate-a2)",
              }}
            />
          )}
        </>
      ) : (
        testSegments.map((segment, i) => {
          const isFirst = i === 0;
          const isLast = i === testSegments.length - 1;
          const completionPct =
            segment.completion <= 1
              ? segment.completion
              : segment.completion / 100;
          const completedWidth = completionPct * 100;
          const remainingWidth = 100 - completedWidth;

          const segmentStyle = {
            height: "24px",
            flex: `0 0 ${segment.weight}%`,
            minWidth: 0,
          };

          return (
            <Flex
              key={i}
              wrap="nowrap"
              className="shrink-0 overflow-hidden transition-all"
              style={segmentStyle}
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
                    backgroundColor: `var(--${segment.color}-9)`,
                  }}
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
                    backgroundColor: `var(--${segment.color}-a4)`,
                  }}
                />
              )}
            </Flex>
          );
        })
      )}
    </Flex>
  );
}
