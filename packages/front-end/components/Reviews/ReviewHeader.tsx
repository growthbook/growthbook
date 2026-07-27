import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import { PiCaretDownBold, PiGitDiff } from "react-icons/pi";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
import RevisionStatusBadge, {
  RevisionLike,
  revisionStatusBadgeVariant,
  revisionStatusColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";

export type ReviewHeaderSubTab = "overview" | "changes";

// One other active draft surfaced in the "N other drafts need attention" nav.
export interface ReviewHeaderOtherDraft {
  key: string;
  version: number;
  title?: string;
  // Used to render the status badge (entity-agnostic).
  badge: RevisionLike;
  onNavigate: () => void;
}

// Shared Review & Publish top section, lifted line-for-line from the feature
// flow (components/Reviews/Feature/ReviewAndPublish.tsx): the revision title +
// inline status badge, the "Merging revision X into the live version
// (revision Y) · based on revision Z" line, the "N other drafts need attention"
// nav, and the Conversation/Changes sub-tab bar with the "Compare revisions"
// affordance.
//
// Entity-agnostic by design (so both features and saved groups can use it):
// every entity-specific value is a prop. `baseVersion` and `reviewRequesterName`
// are optional — when an entity doesn't track them (e.g. saved groups have no
// distinct base revision), the corresponding text is omitted.
export default function ReviewHeader({
  title,
  badgeStatus,
  version,
  liveVersion,
  baseVersion,
  reviewRequesterName,
  lifecycle = "active",
  publishedDate,
  mergedIntoVersion,
  discardedDate,
  otherDrafts,
  subTab,
  setSubTab,
  onCompareRevisions,
  hideSubTabs = false,
}: {
  title: string;
  // Status for the inline badge, normalized to the badge vocabulary by the
  // caller (e.g. the generic "merged" → "published"). Drives both the badge's
  // color and its solid/soft variant (live/discarded read as solid).
  badgeStatus: Parameters<typeof revisionStatusColor>[0];
  version: number;
  // The live revision's version — shown as "into the live version (revision N)".
  liveVersion: number;
  // When set and distinct from the live version, appends "· based on revision N"
  // to the active line; for the discarded lifecycle it renders the inline
  // "(based on revision N)" clause.
  baseVersion?: number;
  // When set, the line reads "<name> requested review to merge …".
  reviewRequesterName?: string;
  // Drives the descriptive line: active (merging), merged, or discarded.
  lifecycle?: "active" | "merged" | "discarded";
  // For the merged lifecycle: optional publish date.
  publishedDate?: Date | string;
  // For the merged lifecycle: when provided, the line reads "was merged into
  // revision N and published …" (features track this; generic entities may not).
  mergedIntoVersion?: number;
  // For the discarded lifecycle: optional discard date ("was discarded on …").
  discardedDate?: Date | string;
  // Other active drafts, surfaced as quick-nav in the header.
  otherDrafts: ReviewHeaderOtherDraft[];
  subTab: ReviewHeaderSubTab;
  setSubTab: (t: ReviewHeaderSubTab) => void;
  onCompareRevisions?: () => void;
  // Suppress the Conversation/Changes sub-tab bar (e.g. the feature flow's
  // focused experiments-checklist step). Defaults to showing the bar.
  hideSubTabs?: boolean;
}) {
  const otherDraftsNav =
    otherDrafts.length === 1 ? (
      <Flex align="center" gap="2">
        <Text color="text-mid" whiteSpace="nowrap">
          1 other draft needs attention:
        </Text>
        <Link weight="medium" onClick={otherDrafts[0].onNavigate}>
          {revisionLabelText(
            otherDrafts[0].version,
            otherDrafts[0].title,
            false,
          )}
        </Link>
        <RevisionStatusBadge
          revision={otherDrafts[0].badge}
          liveVersion={liveVersion}
        />
      </Flex>
    ) : otherDrafts.length > 1 ? (
      <DropdownMenu
        trigger={
          <Link weight="medium">
            {otherDrafts.length} other drafts need attention{" "}
            <PiCaretDownBold size={11} />
          </Link>
        }
        menuPlacement="end"
      >
        {otherDrafts.map((d) => (
          <DropdownMenuItem key={d.key} onClick={d.onNavigate}>
            <Flex align="center" justify="between" gap="4" width="100%">
              <RevisionLabel version={d.version} title={d.title} />
              <RevisionStatusBadge
                revision={d.badge}
                liveVersion={liveVersion}
              />
            </Flex>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    ) : null;

  const staleBase =
    (baseVersion ?? null) !== null && baseVersion !== liveVersion;

  return (
    <Box>
      <Box mb="4">
        <Flex align="start" justify="between" gap="4">
          <Box>
            <Heading as="h3" size="medium" mb="2">
              {title}{" "}
              <span
                style={{
                  display: "inline-block",
                  verticalAlign: "middle",
                  // correct `middle` to the visual center of the glyphs
                  transform: "translateY(-2px)",
                  marginLeft: 4,
                }}
              >
                <Badge
                  variant={revisionStatusBadgeVariant(badgeStatus)}
                  radius="full"
                  color={revisionStatusColor(badgeStatus)}
                  label={revisionStatusLabel(badgeStatus)}
                />
              </span>
            </Heading>
            <Text as="span" color="text-low">
              {lifecycle === "merged" ? (
                <>
                  Revision <strong>{version}</strong>
                  {(mergedIntoVersion ?? null) !== null ? (
                    <>
                      {" "}
                      was merged into revision{" "}
                      <strong>{mergedIntoVersion}</strong> and published
                    </>
                  ) : (
                    <> was published</>
                  )}
                  {publishedDate
                    ? ` on ${format(new Date(publishedDate), "MMM d, yyyy")}`
                    : ""}
                </>
              ) : lifecycle === "discarded" ? (
                (baseVersion ?? null) !== null || discardedDate ? (
                  <>
                    Revision <strong>{version}</strong>
                    {(baseVersion ?? null) !== null ? (
                      <> (based on revision {baseVersion})</>
                    ) : null}{" "}
                    was discarded
                    {discardedDate
                      ? ` on ${format(new Date(discardedDate), "MMM d, yyyy")}`
                      : ""}
                  </>
                ) : (
                  <>
                    Revision <strong>{version}</strong> was discarded and never
                    published
                  </>
                )
              ) : (
                <>
                  {reviewRequesterName ? (
                    <>
                      <strong>{reviewRequesterName}</strong> requested review to
                      merge{" "}
                    </>
                  ) : (
                    <>Merging </>
                  )}
                  revision <strong>{version}</strong> into the live version
                  (revision <strong>{liveVersion}</strong>)
                  {staleBase ? <> · based on revision {baseVersion}</> : null}
                </>
              )}
            </Text>
          </Box>
          {otherDraftsNav && (
            <Box flexShrink="0" pt="1">
              {otherDraftsNav}
            </Box>
          )}
        </Flex>
      </Box>

      {!hideSubTabs && (
        <Box mb="4">
          <Tabs
            value={subTab}
            onValueChange={(v) => setSubTab(v as ReviewHeaderSubTab)}
          >
            <Flex
              align="center"
              justify="between"
              style={{ boxShadow: "inset 0 -1px 0 0 var(--slate-a3)" }}
            >
              <TabsList style={{ boxShadow: "none" }}>
                <TabsTrigger value="overview">Conversation</TabsTrigger>
                <TabsTrigger value="changes">Changes</TabsTrigger>
              </TabsList>
              {onCompareRevisions && (
                <Box pl="2" flexShrink="0">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<PiGitDiff />}
                    onClick={onCompareRevisions}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Compare revisions
                  </Button>
                </Box>
              )}
            </Flex>
          </Tabs>
        </Box>
      )}
    </Box>
  );
}
