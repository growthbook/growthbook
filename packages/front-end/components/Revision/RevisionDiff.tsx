import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
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
              <h4 className="mb-3">Summary of changes</h4>
              {badges.length > 0 && (
                <Flex wrap="wrap" gap="2" className="mb-3">
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
                <div className="list-group mb-4">
                  {customRenderGroups
                    .filter(
                      ({ renders }) => renders.length > 0 && renders[0] != null,
                    )
                    .map(({ label, renders, suppressCardLabel }) => (
                      <div
                        key={label}
                        className="list-group-item list-group-item-light pb-3"
                      >
                        {!suppressCardLabel && (
                          <strong className="d-block mb-2">{label}</strong>
                        )}
                        {renders.map((r, i) => (
                          <div key={i}>{r}</div>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </>
          )}

          {/* Change details */}
          <h4 className="mb-3">Change details</h4>
          <div className="list-group mb-4">
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
              <div className="list-group-item">
                <Text size="medium" color="text-low">
                  No material changes detected
                </Text>
              </div>
            )}
          </div>
        </>
      )}
    </Box>
  );
}
