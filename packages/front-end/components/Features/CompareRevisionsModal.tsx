import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Box, Flex } from "@radix-ui/themes";
import {
  PiArrowsLeftRightBold,
  PiClockClockwise,
  PiWarningBold,
  PiX,
} from "react-icons/pi";
import { datetime } from "shared/dates";
import { DRAFT_REVISION_STATUSES } from "shared/util";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Badge from "@/ui/Badge";
import LoadingOverlay from "@/components/LoadingOverlay";
import EventUser from "@/components/Avatar/EventUser";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Features/RevisionLabel";
import {
  useFeatureRevisionDiff,
  FeatureRevisionDiffInput,
  FeatureRevisionDiff,
  normalizeRevisionMetadata,
  featureToFeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import { logBadgeColor } from "@/components/Features/FeatureDiffRenders";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import {
  COMPACT_DIFF_STYLES,
  dedupeDiffBadges,
} from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import { ExpandableDiff } from "./DraftModal";
import RevisionStatusBadge from "./RevisionStatusBadge";
import styles from "./CompareRevisionsModal.module.scss";

const STORAGE_KEY_PREFIX = "feature:compare-revisions";

export interface Props {
  feature: FeatureInterface;
  /** The live (published) feature — used as the authoritative baseline for preview-mode diffs. */
  baseFeature?: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  currentVersion: number;
  onClose: () => void;
  /** When set, the modal opens directly in "preview draft vs live" mode for this version. */
  initialPreviewDraft?: number;
  /** When set, the modal opens in the given quick-action mode. */
  initialMode?: "most-recent-live";
}

function revisionToDiffInput(
  r: FeatureRevisionInterface,
): FeatureRevisionDiffInput {
  return {
    defaultValue: r.defaultValue,
    rules: r.rules ?? {},
    environmentsEnabled: r.environmentsEnabled,
    prerequisites: r.prerequisites,
    holdout: r.holdout ?? null,
    metadata: normalizeRevisionMetadata(r.metadata),
  };
}

function RevisionCompareLabel({
  versionA,
  versionB,
  revA,
  revB,
  liveVersion,
  revAFailed = false,
  revBFailed = false,
  mb,
  mt,
}: {
  versionA: number;
  versionB: number;
  revA: FeatureRevisionInterface | null;
  revB: FeatureRevisionInterface | null;
  liveVersion: number;
  revAFailed?: boolean;
  revBFailed?: boolean;
  mb?: "1" | "2" | "3" | "4";
  mt?: "1" | "2" | "3" | "4";
}) {
  return (
    <Flex align="center" gap="4" wrap="nowrap" mb={mb} mt={mt}>
      <Flex direction="column">
        <Flex align="center" justify="between" gap="2">
          <Flex align="center" gap="1">
            {revAFailed && (
              <Tooltip body="Could not load revision">
                <PiWarningBold
                  style={{ color: "var(--red-9)", flexShrink: 0 }}
                />
              </Tooltip>
            )}
            <Text weight="semibold" size="medium">
              <OverflowText
                maxWidth={250}
                title={revisionLabelText(versionA, revA?.title)}
              >
                <RevisionLabel version={versionA} title={revA?.title} />
              </OverflowText>
            </Text>
          </Flex>
          <RevisionStatusBadge revision={revA} liveVersion={liveVersion} />
        </Flex>
        {revA && (
          <Text as="div" size="small" color="text-low">
            {datetime(
              (revA.status === "published" ? revA.datePublished : null) ??
                revA.dateUpdated,
            )}{" "}
            · <EventUser user={revA.createdBy} display="name" />
          </Text>
        )}
        {revA &&
          revA.baseVersion !== 0 &&
          (() => {
            return DRAFT_REVISION_STATUSES.includes(revA.status) &&
              revA.baseVersion !== liveVersion ? (
              <HelperText status="warning" size="sm">
                based on: Revision {revA.baseVersion}
              </HelperText>
            ) : (
              <Text as="div" size="small" color="text-low">
                based on: Revision {revA.baseVersion}
              </Text>
            );
          })()}
      </Flex>
      <PiArrowsLeftRightBold size={16} />
      <Flex direction="column">
        <Flex align="center" justify="between" gap="2">
          <Flex align="center" gap="1">
            {revBFailed && (
              <Tooltip body="Could not load revision">
                <PiWarningBold
                  style={{ color: "var(--red-9)", flexShrink: 0 }}
                />
              </Tooltip>
            )}
            <Text weight="semibold" size="medium">
              <OverflowText
                maxWidth={250}
                title={revisionLabelText(versionB, revB?.title)}
              >
                <RevisionLabel version={versionB} title={revB?.title} />
              </OverflowText>
            </Text>
          </Flex>
          <RevisionStatusBadge revision={revB} liveVersion={liveVersion} />
        </Flex>
        {revB && (
          <Text as="div" size="small" color="text-low">
            {datetime(
              (revB.status === "published" ? revB.datePublished : null) ??
                revB.dateUpdated,
            )}{" "}
            · <EventUser user={revB.createdBy} display="name" />
          </Text>
        )}
        {revB &&
          revB.baseVersion !== 0 &&
          (() => {
            return DRAFT_REVISION_STATUSES.includes(revB.status) &&
              revB.baseVersion !== liveVersion ? (
              <HelperText status="warning" size="sm">
                based on: Revision {revB.baseVersion}
              </HelperText>
            ) : (
              <Text as="div" size="small" color="text-low">
                based on: Revision {revB.baseVersion}
              </Text>
            );
          })()}
      </Flex>
    </Flex>
  );
}

function badgesFromDiffs(diffs: FeatureRevisionDiff[]): DiffBadge[] {
  const all = diffs.flatMap((d) => d.badges ?? []);

  // For env-toggle badges (action = "toggle environment <envId>"), keep only
  // the last occurrence so we show the net result across multiple steps.
  const envTogglePrefix = "toggle environment ";
  const envFinal = new Map<string, DiffBadge>();
  const nonEnvBadges: DiffBadge[] = [];
  for (const b of all) {
    if (b.action.startsWith(envTogglePrefix)) {
      const envId = b.action.slice(envTogglePrefix.length);
      envFinal.set(envId, b); // overwrite → last write wins
    } else {
      nonEnvBadges.push(b);
    }
  }

  return dedupeDiffBadges([...nonEnvBadges, ...envFinal.values()]);
}

// Renders the comment for a single revision version. Returns null if there is
// no comment on either the revision object or any "edit comment" log entry.
function RevisionCommentItem({
  featureId,
  version,
  revisionComment,
  title,
}: {
  featureId: string;
  version: number;
  revisionComment?: string | null;
  title?: string | null;
}) {
  const { data } = useApi<{ log: RevisionLog[] }>(
    `/feature/${featureId}/${version}/log`,
  );

  const logEntry = useMemo(() => {
    if (!data?.log) return null;
    const sorted = [...data.log].sort((a, b) =>
      (b.timestamp as unknown as string).localeCompare(
        a.timestamp as unknown as string,
      ),
    );
    for (const entry of sorted) {
      if (entry.action === "edit comment") {
        try {
          const c = JSON.parse(entry.value)?.comment;
          if (c)
            return {
              comment: c as string,
              user: entry.user,
              timestamp: entry.timestamp,
            };
        } catch {
          // ignore
        }
      }
    }
    return null;
  }, [data]);

  const comment = revisionComment || logEntry?.comment;
  if (!comment) return null;

  return (
    <Box>
      <Flex align="center" gap="2" mb="1" wrap="wrap">
        <Text size="medium" weight="medium" color="text-mid">
          <OverflowText
            maxWidth={200}
            title={revisionLabelText(version, title)}
          >
            <RevisionLabel version={version} title={title} />
          </OverflowText>{" "}
          description
        </Text>
        {logEntry?.user && (
          <Text size="small" color="text-low">
            · <EventUser user={logEntry.user} display="name" /> ·{" "}
            {datetime(logEntry.timestamp)}
          </Text>
        )}
      </Flex>
      <Box pl="2" style={{ borderLeft: "2px solid var(--gray-a4)" }} mb="2">
        <Text as="p" color="text-mid" mb="0">
          {comment}
        </Text>
      </Box>
    </Box>
  );
}

function RevisionCommentSection({
  featureId,
  versions,
}: {
  featureId: string;
  versions: Array<{
    version: number;
    revisionComment?: string | null;
    title?: string | null;
  }>;
}) {
  if (versions.length === 0) return null;
  return (
    <Flex direction="column" gap="3" mb="3" mt="4">
      {versions.map(({ version, revisionComment, title }) => (
        <RevisionCommentItem
          key={version}
          featureId={featureId}
          version={version}
          revisionComment={revisionComment}
          title={title}
        />
      ))}
    </Flex>
  );
}

function DiffContent({
  diffs,
  commentVersions,
  feature,
  outOfOrderWarning,
}: {
  diffs: FeatureRevisionDiff[];
  commentVersions: Array<{
    version: number;
    revisionComment?: string | null;
    title?: string | null;
  }>;
  feature: FeatureInterface;
  outOfOrderWarning: boolean;
}) {
  const diffsWithChanges = diffs.filter((d) => d.a !== d.b);
  const withRender = diffsWithChanges.filter((d) => d.customRender);
  const diffFallbackBadges = badgesFromDiffs(diffsWithChanges);
  const hasSummary = diffFallbackBadges.length > 0 || withRender.length > 0;

  const formatSectionTitle = (title: string) => {
    if (title === "Default Value") return "Default value";
    if (title.startsWith("Rules - ")) {
      const env = title.slice("Rules - ".length);
      return `${env.charAt(0).toUpperCase() + env.slice(1)} rules`;
    }
    return title;
  };

  return (
    <>
      <RevisionCommentSection
        featureId={feature.id}
        versions={commentVersions}
      />

      {hasSummary && (
        <Box>
          <Heading as="h5" size="small" color="text-mid" mt="4">
            Summary of changes
          </Heading>

          {diffFallbackBadges.length > 0 && (
            <Flex wrap="wrap" gap="2" mt="2" mb="2">
              {diffFallbackBadges.map(({ label, action }) => (
                <Badge
                  key={label}
                  color={logBadgeColor(action)}
                  variant="soft"
                  label={label}
                />
              ))}
            </Flex>
          )}

          {withRender.length > 0 && (
            <Flex direction="column" gap="0">
              {withRender.map((d) => (
                <Box key={d.title} p="3" my="3" className="rounded bg-light">
                  <Heading as="h6" size="small" color="text-mid" mb="2">
                    {formatSectionTitle(d.title)}
                  </Heading>
                  {d.customRender}
                </Box>
              ))}
            </Flex>
          )}
        </Box>
      )}

      {outOfOrderWarning && (
        <Callout status="info" size="sm" mb="4">
          A draft in this comparison is based on an older version than what is
          currently live. When you publish, it will be merged with the live
          version, so the result may differ from the diff shown here.
        </Callout>
      )}

      {diffsWithChanges.length === 0 ? (
        <Text color="text-low">No changes between these revisions.</Text>
      ) : (
        <>
          {hasSummary && (
            <Heading as="h5" size="small" color="text-mid" mt="4" mb="3">
              Change details
            </Heading>
          )}
          <Flex direction="column" gap="4">
            {diffsWithChanges.map((d) => (
              <ExpandableDiff
                key={d.title}
                title={d.title}
                a={d.a}
                b={d.b}
                defaultOpen
                styles={COMPACT_DIFF_STYLES}
              />
            ))}
          </Flex>
        </>
      )}
    </>
  );
}

export default function CompareRevisionsModal({
  feature,
  baseFeature,
  revisionList,
  revisions,
  currentVersion,
  onClose,
  initialPreviewDraft,
  initialMode,
}: Props) {
  const { apiCall } = useAuth();
  const liveVersion = feature.version;

  const [showDiscarded, setShowDiscarded] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:showDiscarded`,
    false,
  );
  const [showDrafts, setShowDrafts] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:showDrafts`,
    true,
  );
  const [diffViewModeRaw, setDiffViewModeRaw] = useLocalStorage<string>(
    `${STORAGE_KEY_PREFIX}:diffViewMode`,
    "steps",
  );
  const diffViewMode = diffViewModeRaw === "single" ? "single" : "steps";

  const filteredRevisionList = useMemo(
    () =>
      revisionList.filter((r) => {
        if (r.status === "discarded" && !showDiscarded) return false;
        if (DRAFT_REVISION_STATUSES.includes(r.status) && !showDrafts)
          return false;
        return true;
      }),
    [revisionList, showDiscarded, showDrafts],
  );

  const versionsDesc = useMemo(() => {
    const list = [...filteredRevisionList];
    list.sort((a, b) => b.version - a.version);
    return list.map((r) => r.version);
  }, [filteredRevisionList]);

  const defaultAdjacentVersion = useMemo(() => {
    if (versionsDesc.length < 2) return null;
    const idx = versionsDesc.indexOf(currentVersion);
    if (idx < 0) return versionsDesc[1] ?? versionsDesc[0];
    if (idx === versionsDesc.length - 1) {
      return versionsDesc[idx - 1] ?? null;
    }
    return versionsDesc[idx + 1];
  }, [versionsDesc, currentVersion]);

  const [selectedVersions, setSelectedVersions] = useState<number[]>(() => {
    if (initialMode === "most-recent-live") {
      // Compute the live range inline (published-only) so we get the right
      // initial selection without a post-render flash.
      const publishedAsc = revisionList
        .filter((r) => r.status === "published")
        .map((r) => r.version)
        .sort((a, b) => a - b);
      const prevLive =
        publishedAsc.filter((v) => v < liveVersion).at(-1) ?? null;
      if (prevLive !== null) return [prevLive, liveVersion];
    }
    if (!defaultAdjacentVersion) return [currentVersion];
    const pair = [currentVersion, defaultAdjacentVersion].sort((a, b) => a - b);
    return pair;
  });

  // Apply filter flags for initial mode (runs once on mount).
  const initialModeApplied = useRef(false);
  useEffect(() => {
    if (initialMode === "most-recent-live" && !initialModeApplied.current) {
      initialModeApplied.current = true;
      setShowDrafts(false);
      setShowDiscarded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [fetchedRevisions, setFetchedRevisions] = useState<
    Record<number, FeatureRevisionInterface>
  >({});
  const [loadingVersions, setLoadingVersions] = useState<Set<number>>(
    new Set(),
  );
  const [failedVersions, setFailedVersions] = useState<Set<number>>(new Set());
  const fetchingRef = useRef<Set<number>>(new Set());

  const getFullRevision = useCallback(
    (version: number): FeatureRevisionInterface | null => {
      const fromRevisions = revisions.find((r) => r.version === version);
      if (fromRevisions) return fromRevisions;
      return fetchedRevisions[version] ?? null;
    },
    [revisions, fetchedRevisions],
  );

  const fetchRevisions = useCallback(
    async (versions: number[]) => {
      // Filter out already cached or currently in-flight versions
      const toFetch = versions.filter(
        (v) => !getFullRevision(v) && !fetchingRef.current.has(v),
      );
      if (!toFetch.length) return;

      // Clear any previous failures for versions we're about to (re)fetch
      setFailedVersions((prev) => {
        if (!toFetch.some((v) => prev.has(v))) return prev;
        const next = new Set(prev);
        toFetch.forEach((v) => next.delete(v));
        return next;
      });

      toFetch.forEach((v) => fetchingRef.current.add(v));
      setLoadingVersions((prev) => {
        const next = new Set(prev);
        toFetch.forEach((v) => next.add(v));
        return next;
      });

      try {
        const response = await apiCall<{
          revisions: FeatureRevisionInterface[];
        }>(`/feature/${feature.id}/revisions?versions=${toFetch.join(",")}`);
        const returnedVersions = new Set(
          response.revisions?.map((r) => r.version) ?? [],
        );
        if (returnedVersions.size) {
          setFetchedRevisions((prev) => {
            const next = { ...prev };
            response.revisions.forEach((r) => {
              next[r.version] = r;
            });
            return next;
          });
        }
        // Versions that were requested but not returned are definitively missing
        const missing = toFetch.filter((v) => !returnedVersions.has(v));
        if (missing.length) {
          setFailedVersions((prev) => {
            const next = new Set(prev);
            missing.forEach((v) => next.add(v));
            return next;
          });
        }
      } catch {
        // Network / server error — all requested versions failed
        setFailedVersions((prev) => {
          const next = new Set(prev);
          toFetch.forEach((v) => next.add(v));
          return next;
        });
      } finally {
        toFetch.forEach((v) => fetchingRef.current.delete(v));
        setLoadingVersions((prev) => {
          const next = new Set(prev);
          toFetch.forEach((v) => next.delete(v));
          return next;
        });
      }
    },
    [apiCall, feature.id, getFullRevision],
  );

  const selectedSorted = useMemo(() => {
    // selectedVersions holds exactly 2 endpoints [lo, hi]; expand to all
    // visible (non-filtered) versions between them for stepped diffing.
    if (selectedVersions.length < 2) {
      return [...selectedVersions]
        .filter((v) => filteredRevisionList.some((r) => r.version === v))
        .sort((a, b) => a - b);
    }
    const lo = Math.min(...selectedVersions);
    const hi = Math.max(...selectedVersions);
    return filteredRevisionList
      .filter((r) => r.version >= lo && r.version <= hi)
      .map((r) => r.version)
      .sort((a, b) => a - b);
  }, [selectedVersions, filteredRevisionList]);

  // Compare ranges by their endpoints only (both arrays are sorted ascending).
  const isRangeEqual = useCallback(
    (a: number[], b: number[] | null) =>
      !!b &&
      a.length >= 2 &&
      b.length >= 2 &&
      Math.min(...a) === Math.min(...b) &&
      Math.max(...a) === Math.max(...b),
    [],
  );
  const steps = useMemo(() => {
    const pairs: [number, number][] = [];
    for (let i = 0; i < selectedSorted.length - 1; i++) {
      pairs.push([selectedSorted[i], selectedSorted[i + 1]]);
    }
    return pairs.reverse();
  }, [selectedSorted]);

  const selectedSortedSet = useMemo(
    () => new Set(selectedSorted),
    [selectedSorted],
  );

  const [previewDraftVersion, setPreviewDraftVersion] = useState<number | null>(
    initialPreviewDraft ?? null,
  );

  const neededVersions = useMemo(() => {
    const set = new Set(selectedSortedSet);
    if (previewDraftVersion !== null) {
      set.add(liveVersion);
      set.add(previewDraftVersion);
    }
    return set;
  }, [selectedSortedSet, previewDraftVersion, liveVersion]);

  useEffect(() => {
    const missing = [...neededVersions].filter((v) => !getFullRevision(v));
    if (missing.length) fetchRevisions(missing);
  }, [neededVersions, getFullRevision, fetchRevisions]);

  // A version is failed if the fetch completed but it wasn't returned
  const isVersionFailed = useCallback(
    (v: number) =>
      failedVersions.has(v) && !loadingVersions.has(v) && !getFullRevision(v),
    [failedVersions, loadingVersions, getFullRevision],
  );

  const [diffPage, setDiffPage] = useState(0);
  // Helper: reset endpoints to the two newest visible versions.
  const resetToTopTwo = useCallback(
    (prev: number[]) => {
      const top2 = [...filteredRevisionList]
        .sort((a, b) => b.version - a.version)
        .slice(0, 2)
        .map((r) => r.version)
        .sort((a, b) => a - b);
      return top2.length >= 2 ? top2 : prev;
    },
    [filteredRevisionList],
  );

  const prevShowDiscardedRef = useRef(showDiscarded);
  useEffect(() => {
    if (prevShowDiscardedRef.current === showDiscarded) return;
    prevShowDiscardedRef.current = showDiscarded;
    if (!showDiscarded) {
      // If hiding discarded revision knocks out either endpoint, reset.
      setSelectedVersions((prev) => {
        const visibleSet = new Set(filteredRevisionList.map((r) => r.version));
        if (prev.every((v) => visibleSet.has(v))) return prev;
        return resetToTopTwo(prev);
      });
    }
    // When showing discarded: selectedSorted auto-expands to include them.
  }, [showDiscarded, filteredRevisionList, resetToTopTwo]);

  const prevShowDraftsRef = useRef(showDrafts);
  useEffect(() => {
    if (prevShowDraftsRef.current === showDrafts) return;
    prevShowDraftsRef.current = showDrafts;
    if (!showDrafts) {
      // If hiding drafts knocks out either endpoint, reset.
      setSelectedVersions((prev) => {
        const visibleSet = new Set(filteredRevisionList.map((r) => r.version));
        if (prev.every((v) => visibleSet.has(v))) return prev;
        return resetToTopTwo(prev);
      });
    }
  }, [showDrafts, filteredRevisionList, resetToTopTwo]);
  useEffect(() => {
    setDiffPage((p) =>
      steps.length === 0 ? 0 : Math.min(p, steps.length - 1),
    );
  }, [steps.length]);

  // Live/All quick actions hide drafts & discarded so the range only spans
  // published revisions — matching what the user actually sees in production.
  const applyLiveQuickAction = useCallback(
    (range: number[]) => {
      setPreviewDraftVersion(null);
      setShowDrafts(false);
      setShowDiscarded(false);
      setSelectedVersions(range);
      setDiffPage(0);
    },
    [setShowDrafts, setShowDiscarded],
  );
  const safeDiffPage = Math.min(
    Math.max(0, diffPage),
    steps.length > 0 ? steps.length - 1 : 0,
  );

  const toggleVersion = (version: number) => {
    setPreviewDraftVersion(null);
    setSelectedVersions((prev) => {
      const idx = versionsDesc.indexOf(version);
      if (idx === -1) return prev;

      // Find the current selection range as indices in versionsDesc (newest-first)
      const prevIndices = prev
        .map((v) => versionsDesc.indexOf(v))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);

      const startIdx = prevIndices[0] ?? -1; // newest selected (lowest display index)
      const endIdx = prevIndices[prevIndices.length - 1] ?? -1; // oldest selected

      // Clicking an endpoint shrinks the range to the nearest visible item inward.
      // versionsDesc[startIdx] is the newer (top) endpoint; versionsDesc[endIdx] is the older.
      // Visibility = presence in filteredRevisionList (respects draft/discarded filters).
      if (prev.includes(version)) {
        if (startIdx === -1 || endIdx === -1 || endIdx - startIdx <= 1)
          return prev;
        const visibleVersions = new Set(
          filteredRevisionList.map((r) => r.version),
        );
        if (idx === startIdx) {
          let newStart = startIdx + 1;
          while (
            newStart < endIdx &&
            !visibleVersions.has(versionsDesc[newStart])
          )
            newStart++;
          if (newStart >= endIdx) return prev; // no visible item found
          return [versionsDesc[newStart], versionsDesc[endIdx]].sort(
            (a, b) => a - b,
          );
        }
        if (idx === endIdx) {
          let newEnd = endIdx - 1;
          while (
            newEnd > startIdx &&
            !visibleVersions.has(versionsDesc[newEnd])
          )
            newEnd--;
          if (newEnd <= startIdx) return prev; // no visible item found
          return [versionsDesc[startIdx], versionsDesc[newEnd]].sort(
            (a, b) => a - b,
          );
        }
        return prev;
      }

      if (prevIndices.length > 0) {
        // Count visible revisions (in filteredRevisionList) strictly between
        // two indices in versionsDesc (exclusive of endpoints).
        const visibleVersionSet = new Set(
          filteredRevisionList.map((r) => r.version),
        );
        const visibleBetween = (a: number, b: number): number => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          let count = 0;
          for (let i = lo + 1; i < hi; i++) {
            if (visibleVersionSet.has(versionsDesc[i])) count++;
          }
          return count;
        };

        // Clicking within the range: shorten by moving the nearer endpoint.
        // versionsDesc is newest-first, so startIdx (lower) = newer, endIdx (higher) = older.
        // Tiebreaker: move the newer (top) endpoint.
        if (idx > startIdx && idx < endIdx) {
          const distToNewer = idx - startIdx;
          const distToOlder = endIdx - idx;
          if (distToNewer <= distToOlder) {
            return [versionsDesc[idx], versionsDesc[endIdx]].sort(
              (a, b) => a - b,
            );
          } else {
            return [versionsDesc[startIdx], versionsDesc[idx]].sort(
              (a, b) => a - b,
            );
          }
        }

        // If 4+ visible items outside the current range, clear and pair with
        // the item immediately below (older) instead of expanding.
        if (
          (idx < startIdx && visibleBetween(idx, startIdx) >= 8) ||
          (idx > endIdx && visibleBetween(endIdx, idx) >= 8)
        ) {
          if (idx < versionsDesc.length - 1) {
            return [versionsDesc[idx + 1], versionsDesc[idx]].sort(
              (a, b) => a - b,
            );
          }
          // Clicked the very last (oldest) revision — round up to the two newest
          if (versionsDesc.length >= 2) {
            return [versionsDesc[1], versionsDesc[0]].sort((a, b) => a - b);
          }
          return prev;
        }
      }

      const low = Math.min(...prev);
      const high = Math.max(...prev);
      const newLow = Math.min(low, version);
      const newHigh = Math.max(high, version);
      // Store only the two endpoints; selectedSorted derives all intermediate visible versions.
      return [newLow, newHigh];
    });
  };

  const hasDiscardedRevisions = useMemo(
    () => revisionList.some((r) => r.status === "discarded"),
    [revisionList],
  );
  const hasDraftRevisions = useMemo(
    () => revisionList.some((r) => DRAFT_REVISION_STATUSES.includes(r.status)),
    [revisionList],
  );

  // Returns true when a revision is a draft whose base is not the current live
  // version — publishing it would use a 3-way merge, so the diff shown may
  // not match the actual published result.
  const isOutOfOrderDraft = useCallback(
    (rev: FeatureRevisionInterface | null): boolean => {
      if (!rev) return false;
      return (
        DRAFT_REVISION_STATUSES.includes(rev.status) &&
        rev.baseVersion !== liveVersion
      );
    },
    [liveVersion],
  );

  const revisionListByVersion = useMemo(
    () => new Map(filteredRevisionList.map((r) => [r.version, r])),
    [filteredRevisionList],
  );

  // Always computed from the full unfiltered list so quick actions are
  // independent of whatever the user has toggled in the filter checkboxes.
  const mostRecentDraftVersion = useMemo(() => {
    const drafts = revisionList.filter((r) =>
      DRAFT_REVISION_STATUSES.includes(r.status),
    );
    if (drafts.length === 0) return null;
    return Math.max(...drafts.map((r) => r.version));
  }, [revisionList]);

  // Ascending list of published-only versions — used for live/all ranges.
  const publishedVersionsAsc = useMemo(
    () =>
      revisionList
        .filter((r) => r.status === "published")
        .map((r) => r.version)
        .sort((a, b) => a - b),
    [revisionList],
  );

  const quickActionRanges = useMemo(() => {
    // Draft: enter preview mode for the most recent draft vs live.
    const draftPreviewVersion =
      mostRecentDraftVersion !== null && mostRecentDraftVersion !== liveVersion
        ? mostRecentDraftVersion
        : null;

    // Live: previous published → current live (published-only range).
    const prevLiveVersion =
      publishedVersionsAsc.filter((v) => v < liveVersion).at(-1) ?? null;
    const liveRange: [number, number] | null =
      prevLiveVersion !== null ? [prevLiveVersion, liveVersion] : null;

    // All: oldest published → current live.
    const allRange: [number, number] | null =
      publishedVersionsAsc.length >= 2
        ? [
            publishedVersionsAsc[0],
            publishedVersionsAsc[publishedVersionsAsc.length - 1],
          ]
        : null;

    return { draftPreviewVersion, liveRange, allRange };
  }, [mostRecentDraftVersion, liveVersion, publishedVersionsAsc]);

  const currentStep = steps[safeDiffPage];
  const stepRevA = currentStep ? getFullRevision(currentStep[0]) : null;
  const stepRevB = currentStep ? getFullRevision(currentStep[1]) : null;

  // Versions needed by whichever diff view is currently shown
  const displayVersions =
    steps.length === 0
      ? []
      : diffViewMode === "steps" && currentStep
        ? [currentStep[0], currentStep[1]]
        : selectedSorted.length >= 2
          ? [selectedSorted[0], selectedSorted[selectedSorted.length - 1]]
          : [];
  const displayLoading = displayVersions.some((v) => loadingVersions.has(v));
  const displayFailed = displayVersions.filter((v) => isVersionFailed(v));
  const stepDiffs = useFeatureRevisionDiff({
    current: stepRevA
      ? revisionToDiffInput(stepRevA)
      : { defaultValue: "", rules: {} },
    draft: stepRevB
      ? revisionToDiffInput(stepRevB)
      : { defaultValue: "", rules: {} },
  });

  const singleRevFirst =
    selectedSorted.length >= 2 ? getFullRevision(selectedSorted[0]) : null;
  const singleRevLast =
    selectedSorted.length >= 2
      ? getFullRevision(selectedSorted[selectedSorted.length - 1])
      : null;
  const mergedDiffs = useFeatureRevisionDiff({
    current: singleRevFirst
      ? revisionToDiffInput(singleRevFirst)
      : { defaultValue: "", rules: {} },
    draft: singleRevLast
      ? revisionToDiffInput(singleRevLast)
      : { defaultValue: "", rules: {} },
  });

  // Preview draft mode: always live (left) vs draft (right).
  // Use the fully-merged live feature (baseFeature) for the left side so that
  // environmentsEnabled is dense (every env has an explicit true/false) rather
  // than the sparse delta stored on the live revision object. Without this,
  // envs that weren't touched in the most-recent publish show as "unset".
  const previewLiveRev =
    previewDraftVersion !== null ? getFullRevision(liveVersion) : null;
  const previewDraftRev =
    previewDraftVersion !== null ? getFullRevision(previewDraftVersion) : null;
  const liveBase = baseFeature ?? feature;
  const liveBaseInput = useMemo(
    () => featureToFeatureRevisionDiffInput(liveBase),
    [liveBase],
  );
  const previewDiffs = useFeatureRevisionDiff({
    current:
      previewDraftVersion !== null
        ? liveBaseInput
        : { defaultValue: "", rules: {} },
    draft: previewDraftRev
      ? {
          // Use the revision's own defaultValue/rules/prerequisites (full per-revision data),
          // but merge environmentsEnabled on top of the live base so every env is explicit.
          ...revisionToDiffInput(previewDraftRev),
          environmentsEnabled: {
            ...liveBaseInput.environmentsEnabled,
            ...(previewDraftRev.environmentsEnabled ?? {}),
          },
        }
      : { defaultValue: "", rules: {} },
  });
  const previewDisplayLoading =
    previewDraftVersion !== null &&
    (loadingVersions.has(liveVersion) ||
      loadingVersions.has(previewDraftVersion));
  const previewDisplayFailed =
    previewDraftVersion !== null
      ? [liveVersion, previewDraftVersion].filter((v) => isVersionFailed(v))
      : [];

  return (
    <Modal
      trackingEventModalType="compare-revisions"
      open={true}
      header="Compare revisions"
      close={onClose}
      hideCta
      includeCloseCta
      closeCta="Close"
      size="max"
      sizeY="max"
      bodyClassName="p-0"
    >
      <Flex style={{ flex: 1, minHeight: 0 }}>
        <Box
          style={{ width: 300, minWidth: 300, minHeight: 0 }}
          className={`${styles.sidebar} ${styles.sidebarLeft} overflow-auto`}
        >
          {(quickActionRanges.draftPreviewVersion !== null ||
            quickActionRanges.liveRange ||
            quickActionRanges.allRange) && (
            <Box className={`${styles.section} border-bottom`} pb="2">
              <Text
                size="medium"
                weight="medium"
                color="text-mid"
                mb="2"
                as="p"
              >
                Quick actions
              </Text>
              <Flex direction="column" className={styles.quickActionsList}>
                {quickActionRanges.draftPreviewVersion !== null && (
                  <Box
                    className={`${styles.row} ${previewDraftVersion === quickActionRanges.draftPreviewVersion ? styles.rowPreviewDraft : ""}`}
                    onClick={() => {
                      setShowDrafts(true);
                      setPreviewDraftVersion(
                        quickActionRanges.draftPreviewVersion,
                      );
                      setDiffPage(0);
                    }}
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="semibold">Most recent draft changes</Text>
                      <Text size="small" color="text-low">
                        <OverflowText
                          maxWidth={160}
                          title={revisionLabelText(
                            quickActionRanges.draftPreviewVersion,
                            revisionListByVersion.get(
                              quickActionRanges.draftPreviewVersion,
                            )?.title ??
                              getFullRevision(
                                quickActionRanges.draftPreviewVersion,
                              )?.title,
                          )}
                        >
                          <RevisionLabel
                            version={quickActionRanges.draftPreviewVersion}
                            title={
                              revisionListByVersion.get(
                                quickActionRanges.draftPreviewVersion,
                              )?.title ??
                              getFullRevision(
                                quickActionRanges.draftPreviewVersion,
                              )?.title
                            }
                          />
                        </OverflowText>{" "}
                        <PiArrowsLeftRightBold /> live (
                        <OverflowText
                          maxWidth={160}
                          title={revisionLabelText(
                            liveVersion,
                            revisionListByVersion.get(liveVersion)?.title ??
                              getFullRevision(liveVersion)?.title,
                          )}
                        >
                          <RevisionLabel
                            version={liveVersion}
                            title={
                              revisionListByVersion.get(liveVersion)?.title ??
                              getFullRevision(liveVersion)?.title
                            }
                          />
                        </OverflowText>
                        )
                      </Text>
                    </Flex>
                  </Box>
                )}
                {quickActionRanges.liveRange && (
                  <Box
                    className={`${styles.row} ${
                      isRangeEqual(
                        selectedSorted,
                        quickActionRanges.liveRange,
                      ) &&
                      !showDrafts &&
                      !showDiscarded
                        ? styles.rowSelected
                        : ""
                    }`}
                    onClick={() =>
                      quickActionRanges.liveRange &&
                      applyLiveQuickAction(quickActionRanges.liveRange)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="semibold">Most recent live changes</Text>
                      <Text size="small" color="text-low">
                        Revisions {quickActionRanges.liveRange[0]}{" "}
                        <PiArrowsLeftRightBold />{" "}
                        {quickActionRanges.liveRange[1]}
                      </Text>
                    </Flex>
                  </Box>
                )}
                {quickActionRanges.allRange && (
                  <Box
                    className={`${styles.row} ${
                      isRangeEqual(
                        selectedSorted,
                        quickActionRanges.allRange,
                      ) &&
                      !showDrafts &&
                      !showDiscarded
                        ? styles.rowSelected
                        : ""
                    }`}
                    onClick={() =>
                      quickActionRanges.allRange &&
                      applyLiveQuickAction(quickActionRanges.allRange)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="semibold">All changes</Text>
                      <Text size="small" color="text-low">
                        Revisions {quickActionRanges.allRange[0]}{" "}
                        <PiArrowsLeftRightBold />{" "}
                        {quickActionRanges.allRange[1]}
                      </Text>
                    </Flex>
                  </Box>
                )}
              </Flex>
            </Box>
          )}
          <Box className={styles.section} pb="3">
            <Flex align="center" justify="between" mb="2">
              <Text size="medium" weight="medium" color="text-mid">
                Select range of revisions
              </Text>
              {(hasDraftRevisions || hasDiscardedRevisions) &&
                (() => {
                  const opts = [
                    ...(hasDraftRevisions
                      ? [
                          {
                            label: "Show drafts",
                            hidden: !showDrafts,
                            toggle: () => setShowDrafts((v) => !v),
                          },
                        ]
                      : []),
                    ...(hasDiscardedRevisions
                      ? [
                          {
                            label: "Show discarded",
                            hidden: !showDiscarded,
                            toggle: () => setShowDiscarded((v) => !v),
                          },
                        ]
                      : []),
                  ];
                  const count = opts.filter((o) => o.hidden).length;
                  const isShowingAll = count === 0;
                  const isAtDefault =
                    (!hasDraftRevisions || showDrafts) &&
                    (!hasDiscardedRevisions || !showDiscarded);
                  return (
                    <DropdownMenu
                      modal={true}
                      trigger={
                        <Link>
                          Filters
                          {count > 0 && (
                            <Badge
                              color="indigo"
                              variant="solid"
                              radius="full"
                              label={String(count)}
                              style={{ minWidth: 18, height: 18, marginTop: 1 }}
                              ml="1"
                            />
                          )}
                        </Link>
                      }
                      menuPlacement="end"
                      variant="soft"
                    >
                      {!isShowingAll && (
                        <DropdownMenuItem
                          onClick={() => {
                            if (hasDraftRevisions) setShowDrafts(true);
                            if (hasDiscardedRevisions) setShowDiscarded(true);
                          }}
                        >
                          <Flex align="center">
                            <span style={{ width: 24, display: "inline-flex" }}>
                              <PiX size={16} />
                            </span>
                            Remove all filters
                          </Flex>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        disabled={isAtDefault}
                        onClick={() => {
                          setShowDrafts(true);
                          setShowDiscarded(false);
                        }}
                      >
                        <Flex align="center">
                          <span style={{ width: 24, display: "inline-flex" }}>
                            <PiClockClockwise size={16} />
                          </span>
                          {isAtDefault
                            ? "Using default filters"
                            : "Use default filters"}
                        </Flex>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {opts.map((opt) => (
                        <DropdownMenuItem
                          key={opt.label}
                          onClick={() => opt.toggle()}
                        >
                          <Flex align="center">
                            <span
                              style={{
                                width: 24,
                                display: "inline-flex",
                                pointerEvents: "none",
                              }}
                            >
                              <Checkbox
                                value={!opt.hidden}
                                setValue={() => {}}
                              />
                            </span>
                            {opt.label}
                          </Flex>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenu>
                  );
                })()}
            </Flex>
            <Flex direction="column" className={styles.revisionsList}>
              {versionsDesc.map((v) => {
                const minRev = revisionListByVersion.get(v);
                const fullRev = getFullRevision(v);
                const showBase = isOutOfOrderDraft(fullRev);
                const date =
                  minRev?.status === "published"
                    ? minRev?.datePublished
                    : minRev?.dateUpdated;
                const isSelected = selectedSortedSet.has(v);
                const isPreviewDraft = v === previewDraftVersion;
                // In preview mode: check both the draft and the live revision;
                // suppress the normal range selection entirely.
                const checkboxChecked =
                  previewDraftVersion !== null
                    ? v === previewDraftVersion || v === liveVersion
                    : isSelected;
                const isDraftRevision =
                  !!minRev && DRAFT_REVISION_STATUSES.includes(minRev.status);
                const rowId = `compare-rev-${v}`;
                return (
                  <Box key={v} className={styles.rowWrapper}>
                    <label
                      htmlFor={rowId}
                      className={`${styles.row} ${
                        isPreviewDraft
                          ? styles.rowPreviewDraft
                          : previewDraftVersion === null && isSelected
                            ? styles.rowSelected
                            : ""
                      }`}
                    >
                      <span style={{ pointerEvents: "none" }}>
                        <Checkbox
                          id={rowId}
                          value={checkboxChecked}
                          setValue={() => toggleVersion(v)}
                        />
                      </span>
                      <Flex
                        direction="column"
                        gap="1"
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        <Flex
                          align="center"
                          justify="between"
                          gap="2"
                          width="100%"
                        >
                          <Flex
                            align="center"
                            gap="1"
                            style={{ minWidth: 0, flex: 1, overflow: "hidden" }}
                          >
                            {checkboxChecked && isVersionFailed(v) && (
                              <Tooltip body="Could not load revision">
                                <PiWarningBold
                                  style={{
                                    color: "var(--red-9)",
                                    flexShrink: 0,
                                  }}
                                />
                              </Tooltip>
                            )}
                            <div
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                minWidth: 0,
                                fontWeight: "bold",
                              }}
                              title={revisionLabelText(
                                v,
                                minRev?.title ?? fullRev?.title,
                              )}
                            >
                              <RevisionLabel
                                version={v}
                                title={minRev?.title ?? fullRev?.title}
                              />
                            </div>
                          </Flex>
                          {minRev ? (
                            <Box flexShrink="0">
                              <RevisionStatusBadge
                                revision={minRev}
                                liveVersion={liveVersion}
                              />
                            </Box>
                          ) : null}
                        </Flex>
                        {date && minRev ? (
                          <Text size="small" color="text-low">
                            {datetime(date)} ·{" "}
                            <EventUser user={minRev.createdBy} display="name" />
                          </Text>
                        ) : null}
                        {showBase && fullRev && fullRev.baseVersion !== 0 ? (
                          <HelperText status="info" size="sm" mt="1">
                            based on: Revision {fullRev.baseVersion}
                          </HelperText>
                        ) : null}
                      </Flex>
                      {isDraftRevision && previewDraftVersion !== v && (
                        <div className={styles.previewButtonWrapper}>
                          <Button
                            variant="outline"
                            size="xs"
                            className={styles.previewButton}
                            onClick={(e?) => {
                              e?.stopPropagation();
                              e?.preventDefault();
                              setPreviewDraftVersion(v);
                              setDiffPage(0);
                            }}
                          >
                            Compare with live
                          </Button>
                        </div>
                      )}
                    </label>
                  </Box>
                );
              })}
            </Flex>
          </Box>
        </Box>
        <Box
          flexGrow="1"
          position="relative"
          className={`${styles.sidebar} overflow-auto`}
          style={{ minHeight: 0 }}
        >
          {previewDraftVersion !== null ? (
            // ── Preview Draft mode ──────────────────────────────────────────
            <>
              <Box
                pb="3"
                mb="3"
                style={{ borderBottom: "1px solid var(--gray-5)" }}
              >
                <Flex align="center" justify="between" gap="4" wrap="wrap">
                  <Flex align="center" gap="2">
                    <Heading as="h2" size="small" mb="0">
                      Preview draft
                    </Heading>
                    <Text size="small" color="text-low">
                      Draft content vs live (two-way)
                    </Text>
                  </Flex>
                </Flex>
                <RevisionCompareLabel
                  versionA={liveVersion}
                  versionB={previewDraftVersion}
                  revA={previewLiveRev}
                  revB={previewDraftRev}
                  liveVersion={liveVersion}
                  revAFailed={isVersionFailed(liveVersion)}
                  revBFailed={isVersionFailed(previewDraftVersion)}
                  mt="3"
                />
                {previewDraftRev &&
                  previewDraftRev.baseVersion !== liveVersion && (
                    <Callout status="warning" mt="3">
                      Live has changed since this draft was created (based on
                      Revision {previewDraftRev.baseVersion}). Publishing uses
                      three-way merge — only fields the draft explicitly changed
                      from its base will take effect. Use{" "}
                      <strong>Review &amp; Publish</strong> to see the exact
                      changes that will go live.
                    </Callout>
                  )}
              </Box>
              {previewDisplayLoading ? (
                <LoadingOverlay />
              ) : previewDisplayFailed.length > 0 ? (
                <Callout status="error" contentsAs="div" mt="4">
                  <Flex gap="4" align="start">
                    <span>
                      Could not load revision
                      {previewDisplayFailed.length > 1 ? "s" : ""}{" "}
                      {previewDisplayFailed.join(", ")}.
                    </span>
                    <Link onClick={() => fetchRevisions(previewDisplayFailed)}>
                      Reload revision
                      {previewDisplayFailed.length > 1 ? "s" : ""}
                    </Link>
                  </Flex>
                </Callout>
              ) : (
                <DiffContent
                  diffs={previewDiffs}
                  commentVersions={[
                    {
                      version: previewDraftVersion,
                      revisionComment: previewDraftRev?.comment,
                      title: previewDraftRev?.title,
                    },
                  ]}
                  feature={feature}
                  outOfOrderWarning={false}
                />
              )}
            </>
          ) : steps.length === 0 ? (
            <Text color="text-low">
              Select at least two revisions in the list to see the diff.
            </Text>
          ) : (
            // ── Standard range comparison mode ──────────────────────────────
            <>
              <Box
                pb="3"
                mb="3"
                style={{ borderBottom: "1px solid var(--gray-5)" }}
              >
                <Flex align="center" justify="between" gap="4" wrap="wrap">
                  <Flex align="center" gap="4">
                    {diffViewMode === "steps" && (
                      <>
                        <Heading as="h2" size="small" mb="0">
                          Step {safeDiffPage + 1} of {steps.length}
                        </Heading>
                        <Flex gap="2">
                          <Button
                            variant="soft"
                            size="sm"
                            disabled={safeDiffPage <= 0}
                            onClick={() =>
                              setDiffPage((p) => Math.max(0, p - 1))
                            }
                          >
                            Previous
                          </Button>
                          <Button
                            variant="soft"
                            size="sm"
                            disabled={safeDiffPage >= steps.length - 1}
                            onClick={() =>
                              setDiffPage((p) =>
                                Math.min(steps.length - 1, p + 1),
                              )
                            }
                          >
                            Next
                          </Button>
                        </Flex>
                      </>
                    )}
                    {diffViewMode === "single" &&
                      selectedSorted.length >= 2 && (
                        <RevisionCompareLabel
                          versionA={selectedSorted[0]}
                          versionB={selectedSorted[selectedSorted.length - 1]}
                          revA={singleRevFirst}
                          revB={singleRevLast}
                          liveVersion={liveVersion}
                          revAFailed={isVersionFailed(selectedSorted[0])}
                          revBFailed={isVersionFailed(
                            selectedSorted[selectedSorted.length - 1],
                          )}
                        />
                      )}
                  </Flex>
                  <Flex align="center" gap="2">
                    <Text size="medium" weight="medium" color="text-mid">
                      Show diff as
                    </Text>
                    <Select
                      value={diffViewMode}
                      setValue={(v) => setDiffViewModeRaw(v)}
                      size="2"
                      mb="0"
                    >
                      <SelectItem value="steps">Steps</SelectItem>
                      <SelectItem value="single">Single diff</SelectItem>
                    </Select>
                  </Flex>
                </Flex>
                {diffViewMode === "steps" && currentStep && (
                  <RevisionCompareLabel
                    versionA={currentStep[0]}
                    versionB={currentStep[1]}
                    revA={stepRevA}
                    revB={stepRevB}
                    liveVersion={liveVersion}
                    revAFailed={isVersionFailed(currentStep[0])}
                    revBFailed={isVersionFailed(currentStep[1])}
                    mt="3"
                  />
                )}
              </Box>
              {displayLoading ? (
                <LoadingOverlay />
              ) : displayFailed.length > 0 ? (
                <Callout status="error" contentsAs="div" mt="4">
                  <Flex gap="4" align="start">
                    <span>
                      Could not load revision
                      {displayFailed.length > 1 ? "s" : ""}{" "}
                      {displayFailed.join(", ")}.
                    </span>
                    <Link onClick={() => fetchRevisions(displayFailed)}>
                      Reload revision{displayFailed.length > 1 ? "s" : ""}
                    </Link>
                  </Flex>
                </Callout>
              ) : (
                <DiffContent
                  diffs={diffViewMode === "single" ? mergedDiffs : stepDiffs}
                  commentVersions={
                    diffViewMode === "steps" && currentStep
                      ? [currentStep[1], currentStep[0]].map((v) => ({
                          version: v,
                          revisionComment: getFullRevision(v)?.comment,
                          title: getFullRevision(v)?.title,
                        }))
                      : diffViewMode === "single"
                        ? [...selectedSorted].reverse().map((v) => ({
                            version: v,
                            revisionComment: getFullRevision(v)?.comment,
                            title: getFullRevision(v)?.title,
                          }))
                        : []
                  }
                  feature={feature}
                  outOfOrderWarning={
                    diffViewMode === "single"
                      ? isOutOfOrderDraft(singleRevFirst) ||
                        isOutOfOrderDraft(singleRevLast)
                      : isOutOfOrderDraft(stepRevA) ||
                        isOutOfOrderDraft(stepRevB)
                  }
                />
              )}
            </>
          )}
        </Box>
      </Flex>
    </Modal>
  );
}
