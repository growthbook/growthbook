import * as React from "react";
import { Box, Flex } from "@radix-ui/themes";

export type Segment = {
  id: string;
  weight: number; // 0-100, segment weights should sum to 100
  completion: number; // 0-100, completion of the segment
  color: string;
};

type ProgressBarProps = {
  segments?: Segment[];
};

export function ProgressBar({ segments = [] }: ProgressBarProps) {
  const firstSegment = segments[0];
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
                borderRadius: segments.length === 1 ? "0 4px 4px 0" : "0",
                backgroundColor: `var(--${firstSegment.color}-a4)`,
              }}
            />
          )}
          {segments.length > 1 && (
            <Box
              className="h-full min-w-0 flex-1 progress-bar-striped transition-all"
              style={{
                height: "24px",
                borderRadius: "0 4px 4px 0",
                backgroundColor: "var(--slate-a3)",
              }}
            />
          )}
        </>
      ) : (
        segments.map((segment, i) => {
          const isFirst = i === 0;
          const isLast = i === segments.length - 1;
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
