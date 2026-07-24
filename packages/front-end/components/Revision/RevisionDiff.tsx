import React from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import {
  ExpandableDiff,
  DiffCommentsProps,
  CollapsedSection,
  FormattedChanges,
  type FormattedChangeItem,
} from "@/components/Reviews/Feature/RevisionDiffUtils";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import { logBadgeColor } from "@/components/Features/FeatureDiffRenders";
import { DiffItem, DiffBadge, CustomRenderGroup } from "./useRevisionDiff";

interface RevisionDiffProps {
  diffs: DiffItem[];
  badges: DiffBadge[];
  customRenderGroups: CustomRenderGroup[];
  // "full" renders the human-readable summary followed by the JSON diffs
  // (the original layout). "formatted" renders only the summary; "json"
  // renders only the JSON diffs — used by the Review & Publish tab's
  // Conversation / Changes sub-tabs respectively.
  variant?: "full" | "formatted" | "json";
  // Gutter comment wiring for the JSON diffs (see ExpandableDiff). Only
  // honored when JSON diffs are rendered.
  diffComments?: DiffCommentsProps;
  // Cap the formatted summary at this height with a Show more toggle (mirrors
  // the feature Conversation tab; see DiffContent's collapsedMaxHeight).
  collapsedMaxHeight?: number;
}

// Section keys for diff-comment refs may not contain `:` or spaces (see
// diffCommentRefs). Derived from the section label so anchors stay stable as
// long as the diff config's labels are.
export function diffSectionAnchorKey(label: string): string {
  return label.replace(/[^A-Za-z0-9_.-]+/g, "-");
}

export function RevisionDiff({
  diffs,
  badges,
  customRenderGroups,
  variant = "full",
  diffComments,
  collapsedMaxHeight,
}: RevisionDiffProps) {
  const showFormatted = variant !== "json";
  const showJson = variant !== "formatted";

  // Adapt the generic DiffItem[] into the shared FormattedChanges shape so the
  // formatted summary renders identically to the feature flow (humanized
  // headings, titleSuffix, and the Changes-tab link fallback for sections with
  // no human render). customRenderGroups carry the per-section suppressCardLabel
  // flag; map by label so the rendered render survives.
  const renderByLabel = new Map<string, React.ReactNode>();
  for (const g of customRenderGroups) {
    renderByLabel.set(
      g.label,
      g.renders.find((r) => (r ?? null) !== null) ?? null,
    );
  }
  const formattedItems: FormattedChangeItem[] = diffs.map((d) => ({
    title: d.label,
    a: d.a,
    b: d.b,
    customRender: d.customRender ?? renderByLabel.get(d.label) ?? null,
  }));

  return (
    <Box>
      {diffs.length === 0 ? (
        <Text size="medium" color="text-low">
          No changes to display.
        </Text>
      ) : (
        <>
          {/* Summary of changes */}
          {showFormatted && (
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

              {(() => {
                // Strictly human-readable (jsonFallback=false): sections with no
                // customRender link to the Changes tab rather than dropping or
                // showing a JSON diff, matching the feature Conversation tab.
                const view = (
                  <FormattedChanges
                    diffs={formattedItems}
                    jsonFallback={false}
                  />
                );
                return collapsedMaxHeight ? (
                  <CollapsedSection maxHeight={collapsedMaxHeight}>
                    {view}
                  </CollapsedSection>
                ) : (
                  view
                );
              })()}
            </>
          )}

          {/* Change details */}
          {showJson && (
            <>
              <Heading as="h4" size="medium" mb="3">
                Change details
              </Heading>
              <Flex
                direction="column"
                mb="4"
                style={{
                  border:
                    diffs.length > 0 ? undefined : "1px solid var(--gray-a5)",
                  borderRadius:
                    diffs.length > 0 ? undefined : "var(--radius-2)",
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
                      anchorKey={
                        diffComments ? diffSectionAnchorKey(d.label) : undefined
                      }
                      comments={diffComments}
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
        </>
      )}
    </Box>
  );
}
