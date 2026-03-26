import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { RampScheduleInterface } from "shared/validators";
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
import RevisionStatusBadge, {
  isRampGenerated,
} from "@/components/Features/RevisionStatusBadge";
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
import styles from "./CompareRevisionsModal.module.scss";

const STORAGE_KEY_PREFIX = "feature:compare-revisions";

export interface Props {
  feature: FeatureInterface;
  // Live feature, used as authoritative baseline for preview-mode diffs
  baseFeature?: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  currentVersion: number;
  onClose: () => void;
  // Opens directly in "preview draft vs live" mode for this version
  initialPreviewDraft?: number;
  initialMode?: "most-recent-live";
  rampSchedules?: RampScheduleInterface[];
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

  // For env-toggle badges, keep only the last occurrence to show the net result
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
          notes
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

// Build FeatureRevisionDiff items for any ramp schedules linked to a given revision.
// "newerRevision" is the revision being introduced on the right-hand side of the diff.
// Unlike DraftModal (which only shows pending ramps), this is status-agnostic so it works
// for both draft previews and historical published-revision comparisons.
function rampDiffsForRevision(
  newerRevision: FeatureRevisionInterface | null,
  featureId: string,
  rampSchedules: RampScheduleInterface[],
): FeatureRevisionDiff[] {
  if (!newerRevision || !rampSchedules.length) return [];
  const diffs: FeatureRevisionDiff[] = [];

  // Activating: any ramp whose activating revision matches newerRevision (any status)
  for (const ramp of rampSchedules) {
    if (
      !ramp.targets.some(
        (t) =>
          t.entityId === featureId &&
          t.activatingRevisionVersion === newerRevision.version,
      )
    ) {
      continue;
    }

    const alreadyStarted = ramp.status !== "pending";
    const startTriggerType = ramp.startCondition?.trigger.type;
    const startDescription =
      startTriggerType === "immediately"
        ? alreadyStarted
          ? "Started automatically on publish."
          : "Starts automatically on publish."
        : startTriggerType === "manual"
          ? alreadyStarted
            ? "Required manual start after publish."
            : "Requires manual start after publish."
          : alreadyStarted
            ? "Started at a scheduled date/time."
            : "Starts at a scheduled date/time.";

    diffs.push({
      title: `Ramp Schedule – ${ramp.name}`,
      a: "",
      b: JSON.stringify(
        {
          name: ramp.name,
          targets: ramp.targets,
          startCondition: ramp.startCondition,
          steps: ramp.steps,
          endCondition: ramp.endCondition,
          disableRuleBefore: ramp.disableRuleBefore,
          disableRuleAfter: ramp.disableRuleAfter,
        },
        null,
        2,
      ),
      customRender: (
        <p className="mb-0">
          {alreadyStarted ? "Activated" : "Activates"} ramp schedule{" "}
          <strong>{ramp.name}</strong> — {ramp.steps.length} step
          {ramp.steps.length !== 1 ? "s" : ""}. {startDescription}
        </p>
      ),
      badges: [{ label: `Start ramp: ${ramp.name}`, action: "start ramp" }],
    });
  }

  // Approval: ramps that had/have newerRevision as their approval gate
  const approvalRef = `${featureId}:${newerRevision.version}`;
  for (const ramp of rampSchedules) {
    if (ramp.pendingApprovalRevisionId !== approvalRef) continue;
    const stepIndex = ramp.currentStepIndex;
    const thisStep = ramp.steps[stepIndex];
    const prevStepActions =
      stepIndex > 0 ? (ramp.steps[stepIndex - 1]?.actions ?? []) : [];
    diffs.push({
      title: `Ramp Schedule – ${ramp.name}`,
      a: JSON.stringify(prevStepActions, null, 2),
      b: JSON.stringify(thisStep?.actions ?? [], null, 2),
      customRender: (
        <p className="mb-0">
          Advances ramp schedule <strong>{ramp.name}</strong> to step{" "}
          {stepIndex + 1} of {ramp.steps.length}.
        </p>
      ),
      badges: [
        {
          label: `Advance ramp: ${ramp.name} (step ${stepIndex + 1})`,
          action: "advance ramp",
        },
      ],
    });
  }

  return diffs;
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
  rampSchedules = [],
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
  const [showGenerated, setShowGenerated] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:showGenerated`,
    false,
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
        if (isRampGenerated(r) && !showGenerated) return false;
        return true;
      }),
    [revisionList, showDiscarded, showDrafts, showGenerated],
  );

  const versionsDesc = useMemo(() => {
    const list = [...filteredRevisionList];
    list.sort((a, b) => b.version - a.version);
    return list.map((r) => r.version);
  }, [filteredRevisionList]);

  // Compute the default comparison target from the full list so that the
  // initial selection is correct regardless of which filters are active.
  const defaultAdjacentVersion = useMemo(() => {
    const allDesc = [...revisionList]
      .filter((r) => r.status !== "discarded")
      .sort((a, b) => b.version - a.version)
      .map((r) => r.version);
    if (allDesc.length < 2) return null;
    const idx = allDesc.indexOf(currentVersion);
    if (idx < 0) return allDesc[1] ?? allDesc[0];
    if (idx === allDesc.length - 1) return allDesc[idx - 1] ?? null;
    return allDesc[idx + 1];
  }, [revisionList, currentVersion]);

  const [selectedVersions, setSelectedVersions] = useState<number[]>(() => {
    if (initialMode === "most-recent-live") {
      // Compute inline to avoid a post-render flash
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
      // Skip already cached or in-flight versions
      const toFetch = versions.filter(
        (v) => !getFullRevision(v) && !fetchingRef.current.has(v),
      );
      if (!toFetch.length) return;

      // Clear prior failures for versions being (re)fetched
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
        // Versions not returned are definitively missing
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
    // Always keep the selected endpoints even if they're filtered out;
    // expand between them using only the currently visible revisions.
    if (selectedVersions.length < 2) {
      return [...selectedVersions].sort((a, b) => a - b);
    }
    const lo = Math.min(...selectedVersions);
    const hi = Math.max(...selectedVersions);
    const inRange = new Set<number>(selectedVersions);
    filteredRevisionList
      .filter((r) => r.version >= lo && r.version <= hi)
      .forEach((r) => inRange.add(r.version));
    return [...inRange].sort((a, b) => a - b);
  }, [selectedVersions, filteredRevisionList]);

  // Compares ranges by endpoints only
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

  // The sidebar always shows the filtered list plus any selected/preview
  // revisions that would otherwise be hidden by the active filters.
  const sidebarVersionsDesc = useMemo(() => {
    const alwaysVisible = new Set<number>(selectedVersions);
    if (previewDraftVersion !== null) alwaysVisible.add(previewDraftVersion);
    const extra = revisionList.filter(
      (r) =>
        alwaysVisible.has(r.version) &&
        !filteredRevisionList.some((fr) => fr.version === r.version),
    );
    return [...filteredRevisionList, ...extra]
      .sort((a, b) => b.version - a.version)
      .map((r) => r.version);
  }, [
    filteredRevisionList,
    revisionList,
    selectedVersions,
    previewDraftVersion,
  ]);

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
  useEffect(() => {
    setDiffPage((p) =>
      steps.length === 0 ? 0 : Math.min(p, steps.length - 1),
    );
  }, [steps.length]);

  // Hide drafts & discarded so the range spans only published revisions
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

      // Clicking an endpoint shrinks the range to the nearest visible item inward
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
        // Count visible revisions strictly between two indices (exclusive of endpoints)
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

        // Shorten range by moving the nearer endpoint; tiebreaker: move the newer one
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

        // If 8+ visible items outside the range, pair with the adjacent item instead of expanding
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
  const hasGeneratedRevisions = useMemo(
    () => revisionList.some(isRampGenerated),
    [revisionList],
  );

  // True when a draft's base is not the current live version (3-way merge on publish; diff may not match result)
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
    () => new Map(revisionList.map((r) => [r.version, r])),
    [revisionList],
  );

  // Use full unfiltered list so quick actions are independent of filter checkboxes
  const mostRecentDraftVersion = useMemo(() => {
    const drafts = revisionList.filter((r) =>
      DRAFT_REVISION_STATUSES.includes(r.status),
    );
    if (drafts.length === 0) return null;
    return Math.max(...drafts.map((r) => r.version));
  }, [revisionList]);

  const publishedVersionsAsc = useMemo(
    () =>
      revisionList
        .filter((r) => r.status === "published")
        .map((r) => r.version)
        .sort((a, b) => a - b),
    [revisionList],
  );

  const quickActionRanges = useMemo(() => {
    const draftPreviewVersion =
      mostRecentDraftVersion !== null && mostRecentDraftVersion !== liveVersion
        ? mostRecentDraftVersion
        : null;

    const prevLiveVersion =
      publishedVersionsAsc.filter((v) => v < liveVersion).at(-1) ?? null;
    const liveRange: [number, number] | null =
      prevLiveVersion !== null ? [prevLiveVersion, liveVersion] : null;

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

  // Use baseFeature for the left side so environmentsEnabled is dense rather than the sparse delta on the live revision
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
          // Merge environmentsEnabled on top of the live base so every env is explicit
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

  // Augment diffs with ramp schedule context for the "newer" revision in each view
  const stepDiffsWithRamps = useMemo(
    () => [
      ...stepDiffs,
      ...rampDiffsForRevision(stepRevB, feature.id, rampSchedules),
    ],
    [stepDiffs, stepRevB, feature.id, rampSchedules],
  );
  const mergedDiffsWithRamps = useMemo(
    () => [
      ...mergedDiffs,
      ...rampDiffsForRevision(singleRevLast, feature.id, rampSchedules),
    ],
    [mergedDiffs, singleRevLast, feature.id, rampSchedules],
  );
  const previewDiffsWithRamps = useMemo(
    () => [
      ...previewDiffs,
      ...rampDiffsForRevision(previewDraftRev, feature.id, rampSchedules),
    ],
    [previewDiffs, previewDraftRev, feature.id, rampSchedules],
  );

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
              {(hasDraftRevisions ||
                hasDiscardedRevisions ||
                hasGeneratedRevisions) &&
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
                    ...(hasGeneratedRevisions
                      ? [
                          {
                            label: "Show ramp-generated",
                            hidden: !showGenerated,
                            toggle: () => setShowGenerated((v) => !v),
                          },
                        ]
                      : []),
                  ];
                  const count = opts.filter((o) => o.hidden).length;
                  const isShowingAll = count === 0;
                  const isAtDefault =
                    (!hasDraftRevisions || showDrafts) &&
                    (!hasDiscardedRevisions || !showDiscarded) &&
                    (!hasGeneratedRevisions || !showGenerated);
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
                            if (hasGeneratedRevisions) setShowGenerated(true);
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
                          setShowGenerated(false);
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
              {sidebarVersionsDesc.map((v) => {
                const minRev = revisionListByVersion.get(v);
                const fullRev = getFullRevision(v);
                const showBase = isOutOfOrderDraft(fullRev);
                const date =
                  minRev?.status === "published"
                    ? minRev?.datePublished
                    : minRev?.dateUpdated;
                const isSelected = selectedSortedSet.has(v);
                const isPreviewDraft = v === previewDraftVersion;
                // In preview mode: check both draft and live; suppress normal range selection
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
            // Preview draft mode
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
                  diffs={previewDiffsWithRamps}
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
            // Standard range comparison mode
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
                  diffs={
                    diffViewMode === "single"
                      ? mergedDiffsWithRamps
                      : stepDiffsWithRamps
                  }
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
