import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import { ExpandableDiff } from "@/components/Features/DraftModal";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import { logBadgeColor } from "@/components/Features/FeatureDiffRenders";
import { DiffItem, DiffBadge, CustomRenderGroup } from "./useRevisionDiff";

interface RevisionDiffProps {
  diffs: DiffItem[];
  badges: DiffBadge[];
  customRenderGroups: CustomRenderGroup[];
}

export function RevisionDiff({
  diffs,
  badges,
  customRenderGroups,
}: RevisionDiffProps) {
  return (
    <Box mb="6">
      {diffs.length === 0 ? (
        <Text size="medium" color="text-low">
          No changes to display.
        </Text>
      ) : (
        <>
          {/* Summary of changes */}
          {(badges.length > 0 || customRenderGroups.length > 0) && (
            <>
              <Heading as="h4" size="medium" mb="3">
                Summary of changes
              </Heading>
              {badges.length > 0 && (
                <Flex wrap="wrap" gap="2" mb="3">
                  {badges.map(({ label, action }, i) => (
                    <Badge
                      key={`${label}-${i}`}
                      color={logBadgeColor(action)}
                      variant="soft"
                      label={label}
                    />
                  ))}
                </Flex>
              )}

              {customRenderGroups.some(
                ({ renders }) => renders.length > 0 && renders[0] != null,
              ) && (
                <Flex direction="column" gap="0">
                  {customRenderGroups
                    .filter(
                      ({ renders }) => renders.length > 0 && renders[0] != null,
                    )
                    .map(({ label, renders, suppressCardLabel }) => (
                      <Box
                        key={label}
                        p="3"
                        my="3"
                        className="rounded bg-light"
                      >
                        {!suppressCardLabel && (
                          <Heading as="h6" size="small" color="text-mid" mb="2">
                            {label}
                          </Heading>
                        )}
                        {renders.map((r, i) => (
                          <div key={i}>{r}</div>
                        ))}
                      </Box>
                    ))}
                </Flex>
              )}
            </>
          )}

          {/* Change details */}
          <Heading as="h4" size="medium" mb="3">
            Change details
          </Heading>
          <Flex
            direction="column"
            mb="4"
            style={{
              border: diffs.length > 0 ? undefined : "1px solid var(--gray-a5)",
              borderRadius: diffs.length > 0 ? undefined : "var(--radius-2)",
            }}
          >
            {diffs.length > 0 ? (
              diffs.map((d, i) => (
                <ExpandableDiff
                  key={i}
                  title={d.label}
                  a={d.a}
                  b={d.b}
                  defaultOpen={true}
                  styles={COMPACT_DIFF_STYLES}
                />
              ))
            ) : (
              <Box p="3">
                <Text size="medium" color="text-low">
                  No material changes detected
                </Text>
              </Box>
            )}
          </Flex>
        </>
      )}
    </Box>
  );
}
