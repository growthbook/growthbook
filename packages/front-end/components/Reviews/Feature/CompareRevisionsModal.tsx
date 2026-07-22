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
  PiCaretDownBold,
  PiCaretLeftBold,
  PiCaretRightBold,
  PiCaretRightFill,
  PiClockClockwise,
  PiWarningBold,
  PiX,
} from "react-icons/pi";
import { datetime, getValidDate } from "shared/dates";
import { DRAFT_REVISION_STATUSES } from "shared/util";
import type { HoldoutInterface } from "shared/validators";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
// eslint-disable-next-line no-restricted-imports
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Badge from "@/ui/Badge";
import LoadingOverlay from "@/components/LoadingOverlay";
import EventUser from "@/components/Avatar/EventUser";
import Code from "@/components/SyntaxHighlighting/Code";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
import RevisionStatusBadge, {
  isRampGenerated,
} from "@/components/Reviews/RevisionStatusBadge";
import {
  useFeatureRevisionDiff,
  FeatureRevisionDiffInput,
  FeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
  revisionToFeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import {
  CreatedRampScheduleBody,
  RampActionLabel,
  formatSimpleWindow,
} from "@/components/Features/FeatureDiffRenders";
import { useHoldouts, holdoutOccupiesRuleSlot } from "@/hooks/useHoldouts";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import {
  ExpandableDiff,
  RevisionCompareLabel,
  DiffContent,
} from "./RevisionDiffUtils";
import { NON_CONTENT_ACTIONS } from "./CoAuthors";
import { computeBeforeAfter } from "./revisionLogReplay";
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

// Local alias kept for diff readability; logic moved to the diff hook so the
// publish/review surface can use the same envelope backfill.
const revisionToDiffInput = revisionToFeatureRevisionDiffInput;

// FeatureRevisionDiff items for ramp schedules linked to `newerRevision` (the
// right-hand side of the diff). Status-agnostic (unlike DraftModal's
// pending-only view) so it covers both drafts and historical published revisions.
function rampDiffsForRevision(
  newerRevision: FeatureRevisionInterface | null,
  featureId: string,
  rampSchedules: RampScheduleInterface[],
  holdoutsMap: Map<string, HoldoutInterface>,
): FeatureRevisionDiff[] {
  if (!newerRevision) return [];
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

    // "ready" / "pending" are pre-start lifecycle states; everything else
    // (running, paused, completed, rolled-back) means the ramp has already
    // begun, so use past tense.
    const alreadyStarted = ramp.status !== "pending" && ramp.status !== "ready";
    const isSimple = ramp.steps.length === 0;
    const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
    const endAt = ramp.cutoffDate ?? undefined;
    const simpleWindow = formatSimpleWindow(ramp.startDate, endAt);
    const startsClause = alreadyStarted
      ? "started on publish"
      : "starts on publish";
    const detail = isSimple
      ? (simpleWindow ?? startsClause)
      : `${ramp.steps.length} step${ramp.steps.length !== 1 ? "s" : ""}${
          ramp.startDate ? "" : ` · ${startsClause}`
        }`;

    diffs.push({
      title: `${kindLabel} – ${ramp.name}`,
      titleSuffix: <RampActionLabel action="activate" />,
      a: "",
      b: JSON.stringify(
        {
          name: ramp.name,
          targets: ramp.targets,
          startDate: ramp.startDate,
          steps: ramp.steps,
          cutoffDate: ramp.cutoffDate,
        },
        null,
        2,
      ),
      customRender: detail ? (
        <p className="mb-0 text-muted">{detail}.</p>
      ) : null,
      badges: [
        {
          label: `Start ${isSimple ? "schedule" : "ramp"}: ${ramp.name}`,
          action: isSimple ? "start schedule" : "start ramp",
        },
      ],
    });
  }

  // 1-based rule indices for `Rule #N` refs. Holdout occupies #1 (Rule.tsx)
  // only when it's enabled in some env — a feature may carry a disabled
  // holdout reference, in which case the rules list shows no holdout row.
  const newerRules = Array.isArray(newerRevision.rules)
    ? newerRevision.rules
    : [];
  const ruleNumberOffset = holdoutOccupiesRuleSlot(
    newerRevision.holdout,
    holdoutsMap,
  )
    ? 2
    : 1;
  const ruleIndexById = new Map<string, number>(
    newerRules.map((r, i) => [r.id, i + ruleNumberOffset]),
  );
  // Fall back to the raw ID for any rule we can't number (e.g. a detach
  // action whose rule was deleted from the draft).
  const ruleRef = (ruleId: string): string => {
    const idx = ruleIndexById.get(ruleId);
    return idx ? `Rule #${idx}` : `Rule ${ruleId}`;
  };

  // Pending ramp actions (create/update/detach) queued in the draft
  if (newerRevision.rampActions) {
    for (const action of newerRevision.rampActions) {
      if (action.mode === "create") {
        const targetIdx = ruleIndexById.get(action.ruleId);
        const isSimple = action.steps.length === 0;
        const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
        const displayName = action.name ?? "schedule";
        diffs.push({
          title: `${kindLabel} – ${displayName}`,
          a: "",
          b: JSON.stringify(
            {
              name: action.name,
              environment: action.environment,
              ruleId: action.ruleId,
              startDate: action.startDate,
              steps: action.steps,
              cutoffDate: action.cutoffDate,
            },
            null,
            2,
          ),
          customRender: (
            <CreatedRampScheduleBody
              action={action}
              targetRuleIndices={targetIdx ? [targetIdx] : []}
            />
          ),
          titleSuffix: <RampActionLabel action="create" />,
          badges: [
            {
              label: action.name
                ? `Create ${isSimple ? "schedule" : "ramp"}: ${action.name}`
                : `Create ${isSimple ? "schedule" : "ramp schedule"}`,
              action: isSimple ? "create schedule" : "create ramp",
            },
          ],
        });
      } else if (action.mode === "update") {
        const isSimpleUpdate = action.steps.length === 0;
        const kindLabelUpdate = isSimpleUpdate ? "Schedule" : "Ramp Schedule";
        const displayName = action.name ?? "schedule";
        diffs.push({
          title: `${kindLabelUpdate} – ${displayName}`,
          titleSuffix: <RampActionLabel action="update" />,
          a: "",
          b: JSON.stringify(
            {
              rampScheduleId: action.rampScheduleId,
              name: action.name,
              ruleId: action.ruleId,
              startDate: action.startDate,
              steps: action.steps,
              cutoffDate: action.cutoffDate,
            },
            null,
            2,
          ),
          customRender: (
            <p className="mb-0 text-muted">
              {ruleRef(action.ruleId)} · updates schedule configuration.
            </p>
          ),
          badges: [
            {
              label: isSimpleUpdate
                ? "Update schedule"
                : "Update ramp schedule",
              action: "update ramp",
            },
          ],
        });
      } else if (action.mode === "detach") {
        const targetSchedule = rampSchedules.find(
          (r) => r.id === action.rampScheduleId,
        );
        const isSimple = !!targetSchedule && targetSchedule.steps.length === 0;
        const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
        const kindNoun = isSimple ? "schedule" : "ramp schedule";
        const scheduleName = targetSchedule?.name;
        diffs.push({
          title: scheduleName ? `${kindLabel} – ${scheduleName}` : kindLabel,
          titleSuffix: <RampActionLabel action="remove" />,
          a: "",
          b: JSON.stringify(
            {
              rampScheduleId: action.rampScheduleId,
              ruleId: action.ruleId,
              deleteScheduleWhenEmpty: action.deleteScheduleWhenEmpty,
            },
            null,
            2,
          ),
          customRender: (
            <p className="mb-0 text-muted">
              {ruleRef(action.ruleId)} will be removed from this {kindNoun}
              {action.deleteScheduleWhenEmpty &&
                "; the schedule is deleted if no targets remain"}
              .
            </p>
          ),
          badges: [
            {
              label: `Remove from ${kindNoun}`,
              action: isSimple ? "remove schedule" : "remove ramp",
            },
          ],
        });
      }
    }
  }

  // Ramp schedules / actions are separate top-level entities — flag them so the
  // "Raw JSON" view renders one diff each alongside the whole-revision blob.
  return diffs.map((d) => ({ ...d, supplemental: true }));
}

function LogEntryMeta({ log }: { log: RevisionLog }) {
  const rows: [string, React.ReactNode][] = [
    ...(log.subject
      ? ([["Subject", log.subject]] as [string, React.ReactNode][])
      : []),
    [
      "Author",
      <EventUser
        user={log.user}
        display="avatar-name-email"
        size="sm"
        key="author"
        wrap={true}
      />,
    ],
    ["Date", datetime(log.timestamp)],
  ];

  return (
    <Box>
      <Heading as="h4" size="small" mb="3">
        {log.action === "edit comment"
          ? "Edit revision description"
          : log.action}
      </Heading>
      <Flex direction="column" gap="2">
        {rows.map(([label, value]) => (
          <Flex key={label} align="center" gap="3">
            <span style={{ minWidth: 72, flexShrink: 0 }}>
              <Text color="text-mid">{label}</Text>
            </span>
            {value}
          </Flex>
        ))}
      </Flex>
    </Box>
  );
}

function RawLogDetails({ log }: { log: RevisionLog }) {
  const [open, setOpen] = useState(false);

  let prettyValue = log.value;
  try {
    prettyValue = JSON.stringify(JSON.parse(log.value), null, 2);
  } catch {
    // leave as-is
  }

  return (
    <Box mt="5">
      <div
        className="link-purple font-weight-bold"
        style={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((o) => !o)}
      >
        <PiCaretRightFill
          style={{
            display: "inline",
            marginRight: 4,
            transition: "transform 0.15s ease",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        Full log entry
      </div>
      {open && (
        <Box mt="3">
          <div className="diff-wrapper">
            <div className="bg-highlight">
              <Code language="json" code={prettyValue} />
            </div>
          </div>
        </Box>
      )}
    </Box>
  );
}

function LogEntryPanel({
  log,
  allLogs,
  logIndex,
  baseRevision,
}: {
  log: RevisionLog;
  allLogs: RevisionLog[];
  logIndex: number;
  baseRevision: FeatureRevisionInterface | null;
}) {
  const diff = computeBeforeAfter(log, allLogs, logIndex, baseRevision);

  return (
    <Box>
      <LogEntryMeta log={log} />
      {diff && (
        <Box mt="3">
          <ExpandableDiff
            title={diff.title}
            a={diff.a}
            b={diff.b}
            defaultOpen
            styles={COMPACT_DIFF_STYLES}
          />
        </Box>
      )}
      <RawLogDetails log={log} />
    </Box>
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
  rampSchedules = [],
}: Props) {
  const { apiCall } = useAuth();
  const liveVersion = feature.version;
  const { holdoutsMap } = useHoldouts();

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

  // Revision log drill-down state
  const [expandedLogVersions, setExpandedLogVersions] = useState<Set<number>>(
    new Set(),
  );
  const [fetchedLogs, setFetchedLogs] = useState<Record<number, RevisionLog[]>>(
    {},
  );
  const [loadingLogVersions, setLoadingLogVersions] = useState<Set<number>>(
    new Set(),
  );
  const [activeLogEntry, setActiveLogEntry] = useState<{
    version: number;
    logIndex: number;
  } | null>(null);
  const fetchingLogRef = useRef<Set<number>>(new Set());

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

  const fetchRevisionLog = useCallback(
    async (version: number) => {
      if (fetchedLogs[version] !== undefined) return;
      if (fetchingLogRef.current.has(version)) return;
      fetchingLogRef.current.add(version);
      setLoadingLogVersions((prev) => {
        const next = new Set(prev);
        next.add(version);
        return next;
      });
      try {
        const response = await apiCall<{ log: RevisionLog[] }>(
          `/feature/${feature.id}/${version}/log`,
        );
        const sorted = [...(response.log ?? [])].sort(
          (a, b) =>
            getValidDate(a.timestamp).getTime() -
            getValidDate(b.timestamp).getTime(),
        );
        setFetchedLogs((prev) => ({ ...prev, [version]: sorted }));
      } catch {
        setFetchedLogs((prev) => ({ ...prev, [version]: [] }));
      } finally {
        fetchingLogRef.current.delete(version);
        setLoadingLogVersions((prev) => {
          const next = new Set(prev);
          next.delete(version);
          return next;
        });
      }
    },
    [apiCall, feature.id, fetchedLogs],
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
      // Index universe is the sidebar list (filtered list + selected-but-
      // filtered versions). Using `versionsDesc` here would drop a hidden
      // selected endpoint — e.g. an initial-preview draft with "Show drafts"
      // off — and bail the shrink branch, leaving the user unable to deselect.
      const universe = sidebarVersionsDesc;
      const idx = universe.indexOf(version);
      if (idx === -1) return prev;

      const prevIndices = prev
        .map((v) => universe.indexOf(v))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b);

      const startIdx = prevIndices[0] ?? -1; // newest selected (lowest display index)
      const endIdx = prevIndices[prevIndices.length - 1] ?? -1; // oldest selected

      // Clicking an endpoint shrinks the range one step inward.
      if (prev.includes(version)) {
        if (startIdx === -1 || endIdx === -1 || endIdx - startIdx <= 1)
          return prev;
        if (idx === startIdx) {
          return [universe[startIdx + 1], universe[endIdx]].sort(
            (a, b) => a - b,
          );
        }
        if (idx === endIdx) {
          return [universe[startIdx], universe[endIdx - 1]].sort(
            (a, b) => a - b,
          );
        }
        return prev;
      }

      if (prevIndices.length > 0) {
        // Distance is in sidebar terms — items the user can see in the list.
        const distance = (a: number, b: number) =>
          Math.max(0, Math.abs(a - b) - 1);

        // Shorten range by moving the nearer endpoint; tiebreaker: move the newer one
        if (idx > startIdx && idx < endIdx) {
          const distToNewer = idx - startIdx;
          const distToOlder = endIdx - idx;
          if (distToNewer <= distToOlder) {
            return [universe[idx], universe[endIdx]].sort((a, b) => a - b);
          } else {
            return [universe[startIdx], universe[idx]].sort((a, b) => a - b);
          }
        }

        // If 8+ items separate the click from the range, pair with the
        // adjacent item instead of expanding into a giant range.
        if (
          (idx < startIdx && distance(idx, startIdx) >= 8) ||
          (idx > endIdx && distance(endIdx, idx) >= 8)
        ) {
          if (idx < universe.length - 1) {
            return [universe[idx + 1], universe[idx]].sort((a, b) => a - b);
          }
          // Clicked the very last (oldest) revision — round up to the two newest
          if (universe.length >= 2) {
            return [universe[1], universe[0]].sort((a, b) => a - b);
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

  // Backfill source for legacy revisions that don't store envelope fields
  // (metadata, env toggles, prerequisites, holdout). Without this, comparing
  // a pre-snapshot live revision against a freshly created draft produces
  // phantom diffs for every field the draft now snapshots from the feature.
  const liveBase = baseFeature ?? feature;
  const liveBaseInput = useMemo(
    () => featureToFeatureRevisionDiffInput(liveBase),
    [liveBase],
  );

  const stepBeforeInput: FeatureRevisionDiffInput = stepRevA
    ? revisionToDiffInput(stepRevA, liveBaseInput)
    : { defaultValue: "", rules: [] };
  const stepAfterInput: FeatureRevisionDiffInput = stepRevB
    ? revisionToDiffInput(stepRevB, liveBaseInput)
    : { defaultValue: "", rules: [] };
  const stepDiffs = useFeatureRevisionDiff({
    current: stepBeforeInput,
    draft: stepAfterInput,
  });

  const singleRevFirst =
    selectedSorted.length >= 2 ? getFullRevision(selectedSorted[0]) : null;
  const singleRevLast =
    selectedSorted.length >= 2
      ? getFullRevision(selectedSorted[selectedSorted.length - 1])
      : null;
  const mergedBeforeInput: FeatureRevisionDiffInput = singleRevFirst
    ? revisionToDiffInput(singleRevFirst, liveBaseInput)
    : { defaultValue: "", rules: [] };
  const mergedAfterInput: FeatureRevisionDiffInput = singleRevLast
    ? revisionToDiffInput(singleRevLast, liveBaseInput)
    : { defaultValue: "", rules: [] };
  const mergedDiffs = useFeatureRevisionDiff({
    current: mergedBeforeInput,
    draft: mergedAfterInput,
  });

  const previewLiveRev =
    previewDraftVersion !== null ? getFullRevision(liveVersion) : null;
  const previewDraftRev =
    previewDraftVersion !== null ? getFullRevision(previewDraftVersion) : null;
  const previewBeforeInput: FeatureRevisionDiffInput =
    previewDraftVersion !== null
      ? liveBaseInput
      : { defaultValue: "", rules: [] };
  const previewAfterInput: FeatureRevisionDiffInput = previewDraftRev
    ? {
        // Merge environmentsEnabled on top of the live base so every env is explicit
        ...revisionToDiffInput(previewDraftRev),
        environmentsEnabled: {
          ...liveBaseInput.environmentsEnabled,
          ...(previewDraftRev.environmentsEnabled ?? {}),
        },
      }
    : { defaultValue: "", rules: [] };
  const previewDiffs = useFeatureRevisionDiff({
    current: previewBeforeInput,
    draft: previewAfterInput,
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
      ...rampDiffsForRevision(stepRevB, feature.id, rampSchedules, holdoutsMap),
    ],
    [stepDiffs, stepRevB, feature.id, rampSchedules, holdoutsMap],
  );
  const mergedDiffsWithRamps = useMemo(
    () => [
      ...mergedDiffs,
      ...rampDiffsForRevision(
        singleRevLast,
        feature.id,
        rampSchedules,
        holdoutsMap,
      ),
    ],
    [mergedDiffs, singleRevLast, feature.id, rampSchedules, holdoutsMap],
  );
  const previewDiffsWithRamps = useMemo(
    () => [
      ...previewDiffs,
      ...rampDiffsForRevision(
        previewDraftRev,
        feature.id,
        rampSchedules,
        holdoutsMap,
      ),
    ],
    [previewDiffs, previewDraftRev, feature.id, rampSchedules, holdoutsMap],
  );

  return (
    <Modal
      useRadixButton={false}
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
                const isExpanded = expandedLogVersions.has(v);
                const versionLogs = fetchedLogs[v];
                const isLoadingLogs = loadingLogVersions.has(v);
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
                      onClick={() => setActiveLogEntry(null)}
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
                            <Flex align="center" gap="1" flexShrink="0">
                              <RevisionStatusBadge
                                revision={minRev}
                                liveVersion={liveVersion}
                              />
                            </Flex>
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
                      <div className={styles.rowCaret}>
                        <Tooltip
                          body={
                            isExpanded
                              ? "Collapse log entries"
                              : "Expand log entries"
                          }
                        >
                          <button
                            type="button"
                            className={styles.expandChevron}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const next = new Set(expandedLogVersions);
                              if (isExpanded) {
                                next.delete(v);
                                if (activeLogEntry?.version === v) {
                                  setActiveLogEntry(null);
                                }
                              } else {
                                next.add(v);
                                fetchRevisionLog(v);
                              }
                              setExpandedLogVersions(next);
                            }}
                          >
                            {isExpanded ? (
                              <PiCaretDownBold size={12} />
                            ) : (
                              <PiCaretRightBold size={12} />
                            )}
                          </button>
                        </Tooltip>
                      </div>
                    </label>
                    {isExpanded && (
                      <div className={styles.logSubRows}>
                        {isLoadingLogs ? (
                          <Text size="small" color="text-low" ml="2">
                            Loading…
                          </Text>
                        ) : versionLogs && versionLogs.length > 0 ? (
                          (() => {
                            const contentLogs = versionLogs.flatMap(
                              (logEntry, idx) =>
                                NON_CONTENT_ACTIONS.has(logEntry.action)
                                  ? []
                                  : [{ logEntry, idx }],
                            );
                            if (contentLogs.length === 0) {
                              return (
                                <Text size="small" color="text-low" ml="2">
                                  No changes in this revision
                                </Text>
                              );
                            }
                            return contentLogs.map(({ logEntry, idx }) => {
                              const isActive =
                                activeLogEntry?.version === v &&
                                activeLogEntry.logIndex === idx;
                              return (
                                <div
                                  key={idx}
                                  className={`${styles.logSubRow} ${
                                    isActive ? styles.logSubRowActive : ""
                                  }`}
                                  onClick={() =>
                                    setActiveLogEntry(
                                      isActive
                                        ? null
                                        : { version: v, logIndex: idx },
                                    )
                                  }
                                >
                                  <Flex
                                    direction="column"
                                    gap="1"
                                    style={{ minWidth: 0, flex: 1 }}
                                  >
                                    <div
                                      style={{
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        fontWeight: isActive ? "bold" : 500,
                                      }}
                                    >
                                      {logEntry.action}
                                      {logEntry.subject
                                        ? ` · ${logEntry.subject}`
                                        : ""}
                                    </div>
                                    <Text size="small" color="text-low">
                                      {datetime(logEntry.timestamp)}
                                      {logEntry.user?.type === "dashboard"
                                        ? ` · ${logEntry.user.name}`
                                        : logEntry.user?.type === "api_key"
                                          ? logEntry.user.name
                                            ? ` · ${logEntry.user.name} (API)`
                                            : logEntry.user.email
                                              ? ` · ${logEntry.user.email} (API)`
                                              : " · API"
                                          : ""}
                                    </Text>
                                  </Flex>
                                </div>
                              );
                            });
                          })()
                        ) : (
                          <Text size="small" color="text-low" ml="2">
                            No log entries
                          </Text>
                        )}
                      </div>
                    )}
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
          {activeLogEntry !== null &&
          fetchedLogs[activeLogEntry.version]?.[activeLogEntry.logIndex] ? (
            // Log entry drill-down panel
            <>
              <Box
                pb="3"
                mb="3"
                style={{ borderBottom: "1px solid var(--gray-5)" }}
              >
                <Flex align="center" gap="2" wrap="wrap">
                  <Tooltip body="Return to revision">
                    <button
                      type="button"
                      className={styles.backButton}
                      onClick={() => setActiveLogEntry(null)}
                    >
                      <PiCaretLeftBold size={16} />
                    </button>
                  </Tooltip>
                  <Heading as="h2" size="small" mb="0">
                    Log entry
                  </Heading>
                  <Text size="small" color="text-low">
                    · Revision {activeLogEntry.version}
                  </Text>
                </Flex>
              </Box>
              {(() => {
                const allLogs = fetchedLogs[activeLogEntry.version];
                const logEntry = allLogs[activeLogEntry.logIndex];
                const rev = getFullRevision(activeLogEntry.version);
                const baseRevision = rev?.baseVersion
                  ? getFullRevision(rev.baseVersion)
                  : null;
                return (
                  <LogEntryPanel
                    log={logEntry}
                    allLogs={allLogs}
                    logIndex={activeLogEntry.logIndex}
                    baseRevision={baseRevision}
                  />
                );
              })()}
            </>
          ) : previewDraftVersion !== null ? (
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
                  logsA={fetchedLogs[liveVersion]}
                  logsB={fetchedLogs[previewDraftVersion]}
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
                <Callout status="error" mt="4">
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
                  raw={{ before: previewBeforeInput, after: previewAfterInput }}
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
                <Flex align="start" justify="between" gap="4" wrap="wrap">
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
                          logsA={fetchedLogs[selectedSorted[0]]}
                          logsB={
                            fetchedLogs[
                              selectedSorted[selectedSorted.length - 1]
                            ]
                          }
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
                      size="small"
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
                    logsA={fetchedLogs[currentStep[0]]}
                    logsB={fetchedLogs[currentStep[1]]}
                    mt="3"
                  />
                )}
              </Box>
              {displayLoading ? (
                <LoadingOverlay />
              ) : displayFailed.length > 0 ? (
                <Callout status="error" mt="4">
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
                  raw={
                    diffViewMode === "single"
                      ? { before: mergedBeforeInput, after: mergedAfterInput }
                      : { before: stepBeforeInput, after: stepAfterInput }
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
