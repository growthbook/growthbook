import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowsLeftRightBold } from "react-icons/pi";
import { datetime } from "shared/dates";
import { DRAFT_REVISION_STATUSES } from "shared/util";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import { Select, SelectItem } from "@/ui/Select";
import Switch from "@/ui/Switch";
import LoadingOverlay from "@/components/LoadingOverlay";
import EventUser from "@/components/Avatar/EventUser";
import {
  useFeatureRevisionDiff,
  FeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import { ExpandableDiff } from "./DraftModal";
import RevisionStatusBadge from "./RevisionStatusBadge";
import styles from "./CompareRevisionsModal.module.scss";

const STORAGE_KEY_PREFIX = "feature:compare-revisions";

export interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  currentVersion: number;
  onClose: () => void;
}

function revisionToDiffInput(
  r: FeatureRevisionInterface,
): FeatureRevisionDiffInput {
  return { defaultValue: r.defaultValue, rules: r.rules ?? {} };
}

function RevisionCompareLabel({
  versionA,
  versionB,
  revA,
  revB,
  liveVersion,
  mb,
}: {
  versionA: number;
  versionB: number;
  revA: FeatureRevisionInterface | null;
  revB: FeatureRevisionInterface | null;
  liveVersion: number;
  mb?: "1" | "2" | "3" | "4";
}) {
  return (
    <Flex align="center" gap="4" wrap="nowrap" mb={mb}>
      <Flex direction="column">
        <Flex align="center" justify="between" gap="2">
          <Text weight="semibold" size="medium">
            Revision {versionA}
          </Text>
          <RevisionStatusBadge revision={revA} liveVersion={liveVersion} />
        </Flex>
        {revA &&
          revA.baseVersion !== 0 &&
          (DRAFT_REVISION_STATUSES.includes(revA.status) &&
          revA.baseVersion !== liveVersion ? (
            <HelperText status="warning" size="sm">
              based on: {revA.baseVersion}
            </HelperText>
          ) : (
            <Text as="div" size="small" color="text-low">
              based on: {revA.baseVersion}
            </Text>
          ))}
      </Flex>
      <PiArrowsLeftRightBold size={16} />
      <Flex direction="column">
        <Flex align="center" justify="between" gap="2">
          <Text weight="semibold" size="medium">
            Revision {versionB}
          </Text>
          <RevisionStatusBadge revision={revB} liveVersion={liveVersion} />
        </Flex>
        {revB &&
          revB.baseVersion !== 0 &&
          (DRAFT_REVISION_STATUSES.includes(revB.status) &&
          revB.baseVersion !== liveVersion ? (
            <HelperText status="warning" size="sm">
              based on: {revB.baseVersion}
            </HelperText>
          ) : (
            <Text as="div" size="small" color="text-low">
              based on: {revB.baseVersion}
            </Text>
          ))}
      </Flex>
    </Flex>
  );
}

export default function CompareRevisionsModal({
  feature,
  revisionList,
  revisions,
  currentVersion,
  onClose,
}: Props) {
  const { apiCall } = useAuth();
  const liveVersion = feature.version;

  const [showDiscarded, setShowDiscarded] = useLocalStorage(
    `${STORAGE_KEY_PREFIX}:showDiscarded`,
    false,
  );
  const [diffViewModeRaw, setDiffViewModeRaw] = useLocalStorage<string>(
    `${STORAGE_KEY_PREFIX}:diffViewMode`,
    "steps",
  );
  const diffViewMode = diffViewModeRaw === "single" ? "single" : "steps";

  const filteredRevisionList = useMemo(
    () =>
      showDiscarded
        ? revisionList
        : revisionList.filter((r) => r.status !== "discarded"),
    [revisionList, showDiscarded],
  );

  const versionsDesc = useMemo(() => {
    const list = [...filteredRevisionList];
    list.sort((a, b) => b.version - a.version);
    return list.map((r) => r.version);
  }, [filteredRevisionList]);

  const versionsAsc = useMemo(
    () => [...versionsDesc].sort((a, b) => a - b),
    [versionsDesc],
  );

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
    if (defaultAdjacentVersion == null) return [currentVersion];
    const pair = [currentVersion, defaultAdjacentVersion].sort((a, b) => a - b);
    return pair;
  });

  const [fetchedRevisions, setFetchedRevisions] = useState<
    Record<number, FeatureRevisionInterface>
  >({});
  const [loadingVersions, setLoadingVersions] = useState<Set<number>>(
    new Set(),
  );
  const fetchingRef = useRef<Set<number>>(new Set());

  const getFullRevision = useCallback(
    (version: number): FeatureRevisionInterface | null => {
      const fromRevisions = revisions.find((r) => r.version === version);
      if (fromRevisions) return fromRevisions;
      return fetchedRevisions[version] ?? null;
    },
    [revisions, fetchedRevisions],
  );

  const fetchRevision = useCallback(
    async (version: number) => {
      if (getFullRevision(version)) return;
      if (fetchingRef.current.has(version)) return;
      fetchingRef.current.add(version);
      setLoadingVersions((prev) => new Set(prev).add(version));
      try {
        const response = await apiCall<{
          revisions: FeatureRevisionInterface[];
        }>(`/feature/${feature.id}?v=${version}`);
        const rev = response.revisions?.find((r) => r.version === version);
        if (rev) {
          setFetchedRevisions((prev) => ({ ...prev, [version]: rev }));
        }
      } finally {
        fetchingRef.current.delete(version);
        setLoadingVersions((prev) => {
          const next = new Set(prev);
          next.delete(version);
          return next;
        });
      }
    },
    [apiCall, feature.id, getFullRevision],
  );

  const selectedSorted = useMemo(
    () =>
      [...selectedVersions]
        .filter((v) => filteredRevisionList.some((r) => r.version === v))
        .sort((a, b) => a - b),
    [selectedVersions, filteredRevisionList],
  );

  const isRangeEqual = useCallback(
    (a: number[], b: number[] | null) =>
      b != null && a.length === b.length && a.every((v, i) => v === b[i]),
    [],
  );
  const steps = useMemo(() => {
    const pairs: [number, number][] = [];
    for (let i = 0; i < selectedSorted.length - 1; i++) {
      pairs.push([selectedSorted[i], selectedSorted[i + 1]]);
    }
    return pairs.reverse();
  }, [selectedSorted]);

  const neededVersions = useMemo(
    () => new Set(selectedSorted),
    [selectedSorted],
  );

  useEffect(() => {
    neededVersions.forEach((v) => {
      if (!getFullRevision(v)) fetchRevision(v);
    });
  }, [neededVersions, getFullRevision, fetchRevision]);

  const allLoaded = selectedSorted.every((v) => getFullRevision(v) != null);
  const anyLoading = loadingVersions.size > 0;

  const [diffPage, setDiffPage] = useState(0);
  const canToggleDiffView = selectedSorted.length > 2;
  const prevShowDiscardedRef = useRef(showDiscarded);
  useEffect(() => {
    if (prevShowDiscardedRef.current === showDiscarded) return;
    prevShowDiscardedRef.current = showDiscarded;
    if (!showDiscarded) {
      setSelectedVersions((prev) => {
        const next = prev.filter((v) =>
          filteredRevisionList.some((r) => r.version === v),
        );
        return next.length > 0 ? next : prev;
      });
    } else {
      setSelectedVersions((prev) => {
        if (prev.length === 0) return prev;
        const min = Math.min(...prev);
        const max = Math.max(...prev);
        const filled = revisionList
          .filter((r) => r.version >= min && r.version <= max)
          .map((r) => r.version);
        return [...new Set(filled)].sort((a, b) => a - b);
      });
    }
  }, [showDiscarded, filteredRevisionList, revisionList]);
  useEffect(() => {
    setDiffPage((p) =>
      steps.length === 0 ? 0 : Math.min(p, steps.length - 1),
    );
  }, [steps.length]);
  const applyQuickAction = useCallback((range: number[]) => {
    setSelectedVersions(range);
    setDiffPage(0);
  }, []);
  const safeDiffPage = Math.min(
    Math.max(0, diffPage),
    steps.length > 0 ? steps.length - 1 : 0,
  );

  const toggleVersion = (version: number) => {
    setSelectedVersions((prev) => {
      const low = Math.min(...prev);
      const high = Math.max(...prev);
      if (prev.includes(version)) {
        if (prev.length <= 2) return prev;
        const left = prev.filter((v) => v < version).sort((a, b) => a - b);
        const right = prev.filter((v) => v > version).sort((a, b) => a - b);
        if (left.length >= 2 && right.length >= 2) {
          return left.includes(currentVersion)
            ? left
            : right.includes(currentVersion)
              ? right
              : left.length >= right.length
                ? left
                : right;
        }
        if (left.length >= 2) return left;
        if (right.length >= 2) return right;
        return prev;
      }
      const newLow = Math.min(low, version);
      const newHigh = Math.max(high, version);
      return versionsAsc.filter((v) => v >= newLow && v <= newHigh);
    });
  };

  const hasDiscardedRevisions = useMemo(
    () => revisionList.some((r) => r.status === "discarded"),
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

  const mostRecentDraftVersion = useMemo(() => {
    const drafts = filteredRevisionList.filter((r) =>
      DRAFT_REVISION_STATUSES.includes(r.status),
    );
    if (drafts.length === 0) return null;
    return Math.max(...drafts.map((r) => r.version));
  }, [filteredRevisionList]);

  const quickActionRanges = useMemo(() => {
    const draftLow =
      mostRecentDraftVersion != null && liveVersion != null
        ? Math.min(mostRecentDraftVersion, liveVersion)
        : null;
    const draftHigh =
      mostRecentDraftVersion != null && liveVersion != null
        ? Math.max(mostRecentDraftVersion, liveVersion)
        : null;
    const draftRange: number[] | null =
      draftLow != null &&
      draftHigh != null &&
      draftLow !== draftHigh &&
      versionsAsc.includes(draftLow) &&
      versionsAsc.includes(draftHigh)
        ? versionsAsc.filter((v) => v >= draftLow && v <= draftHigh)
        : null;
    const livePrev = liveVersion - 1;
    const liveRange: number[] | null =
      versionsAsc.includes(livePrev) && versionsAsc.includes(liveVersion)
        ? [livePrev, liveVersion]
        : null;
    const allRange: number[] | null =
      versionsAsc.length >= 2 ? [...versionsAsc] : null;
    return { draftRange, liveRange, allRange };
  }, [mostRecentDraftVersion, liveVersion, versionsAsc]);

  const currentStep = steps[safeDiffPage];
  const stepRevA = currentStep ? getFullRevision(currentStep[0]) : null;
  const stepRevB = currentStep ? getFullRevision(currentStep[1]) : null;
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
          {(quickActionRanges.draftRange ||
            quickActionRanges.liveRange ||
            quickActionRanges.allRange) && (
            <Box className={`${styles.section} border-bottom`}>
              <Text
                size="medium"
                weight="regular"
                color="text-mid"
                mb="2"
                as="p"
              >
                Quick actions
              </Text>
              <Flex direction="column" className={styles.quickActionsList}>
                {quickActionRanges.draftRange && (
                  <Box
                    className={`${styles.row} ${isRangeEqual(selectedSorted, quickActionRanges.draftRange) ? styles.rowSelected : ""}`}
                    onClick={() =>
                      quickActionRanges.draftRange &&
                      applyQuickAction(quickActionRanges.draftRange)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="semibold">Most recent draft changes</Text>
                      <Text size="small" color="text-low">
                        Revisions {quickActionRanges.draftRange[0]}{" "}
                        <PiArrowsLeftRightBold />{" "}
                        {
                          quickActionRanges.draftRange[
                            quickActionRanges.draftRange.length - 1
                          ]
                        }
                      </Text>
                    </Flex>
                  </Box>
                )}
                {quickActionRanges.liveRange && (
                  <Box
                    className={`${styles.row} ${isRangeEqual(selectedSorted, quickActionRanges.liveRange) ? styles.rowSelected : ""}`}
                    onClick={() =>
                      quickActionRanges.liveRange &&
                      applyQuickAction(quickActionRanges.liveRange)
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
                    className={`${styles.row} ${isRangeEqual(selectedSorted, quickActionRanges.allRange) ? styles.rowSelected : ""}`}
                    onClick={() =>
                      quickActionRanges.allRange &&
                      applyQuickAction(quickActionRanges.allRange)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                      <Text weight="semibold">All changes</Text>
                      <Text size="small" color="text-low">
                        Revisions {quickActionRanges.allRange[0]}{" "}
                        <PiArrowsLeftRightBold />{" "}
                        {
                          quickActionRanges.allRange[
                            quickActionRanges.allRange.length - 1
                          ]
                        }
                      </Text>
                    </Flex>
                  </Box>
                )}
              </Flex>
            </Box>
          )}
          <Box className={styles.section} pb="3">
            <Text size="medium" weight="regular" color="text-mid" mb="2" as="p">
              Select range of revisions
            </Text>
            {hasDiscardedRevisions && (
              <Flex gap="2" mb="2" justify="end" align="center">
                <Text size="small" color="text-low">
                  Show discarded revisions
                </Text>
                <Switch
                  size="1"
                  value={showDiscarded}
                  onChange={setShowDiscarded}
                  color="gray"
                />
              </Flex>
            )}
            <Flex direction="column" className={styles.revisionsList}>
              {versionsDesc.map((v) => {
                const minRev = revisionListByVersion.get(v);
                const fullRev = getFullRevision(v);
                const showBase = isOutOfOrderDraft(fullRev);
                const date =
                  minRev?.status === "published"
                    ? minRev?.datePublished
                    : minRev?.dateUpdated;
                const isSelected = selectedVersions.includes(v);
                const rowId = `compare-rev-${v}`;
                return (
                  <Box
                    key={v}
                    asChild
                    className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
                  >
                    <label htmlFor={rowId}>
                      <span style={{ pointerEvents: "none" }}>
                        <Checkbox
                          id={rowId}
                          value={isSelected}
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
                          <Text weight="semibold">Revision {v}</Text>
                          {minRev && (
                            <RevisionStatusBadge
                              revision={minRev}
                              liveVersion={liveVersion}
                            />
                          )}
                        </Flex>
                        {date && minRev && (
                          <Text size="small" color="text-low">
                            {datetime(date)} ·{" "}
                            <EventUser user={minRev.createdBy} display="name" />
                          </Text>
                        )}
                        {showBase && fullRev && fullRev.baseVersion !== 0 && (
                          <HelperText status="info" size="sm" mt="1">
                            based on: {fullRev.baseVersion}
                          </HelperText>
                        )}
                      </Flex>
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
          {steps.length === 0 ? (
            <Text color="text-low">
              Select at least two revisions in the list to see the diff.
            </Text>
          ) : !allLoaded ? (
            anyLoading ? (
              <LoadingOverlay />
            ) : (
              <Flex direction="column" gap="3" align="start">
                <Text color="text-low">
                  Some revisions could not be loaded. You can retry or choose
                  different revisions.
                </Text>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => {
                    selectedSorted
                      .filter((v) => !getFullRevision(v))
                      .forEach((v) => fetchRevision(v));
                  }}
                >
                  Retry loading
                </Button>
              </Flex>
            )
          ) : (
            <>
              <Flex align="center" justify="between" mb="3" gap="4" wrap="wrap">
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
                          onClick={() => setDiffPage((p) => Math.max(0, p - 1))}
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
                  {diffViewMode === "single" && selectedSorted.length >= 2 && (
                    <RevisionCompareLabel
                      versionA={selectedSorted[0]}
                      versionB={selectedSorted[selectedSorted.length - 1]}
                      revA={singleRevFirst}
                      revB={singleRevLast}
                      liveVersion={liveVersion}
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
                    disabled={!canToggleDiffView}
                    size="2"
                    mb="0"
                  >
                    <SelectItem value="steps">Steps</SelectItem>
                    <SelectItem value="single">Single diff</SelectItem>
                  </Select>
                </Flex>
              </Flex>
              <>
                {diffViewMode === "steps" && currentStep && (
                  <RevisionCompareLabel
                    versionA={currentStep[0]}
                    versionB={currentStep[1]}
                    revA={stepRevA}
                    revB={stepRevB}
                    liveVersion={liveVersion}
                    mb="3"
                  />
                )}
                {(diffViewMode === "single"
                  ? isOutOfOrderDraft(singleRevFirst) ||
                    isOutOfOrderDraft(singleRevLast)
                  : isOutOfOrderDraft(stepRevA) ||
                    isOutOfOrderDraft(stepRevB)) && (
                  <Callout status="info" size="sm" mb="4">
                    A draft in this comparison is based on an older version than
                    what is currently live. When you publish, it will be merged
                    with the live version, so the result may differ from the
                    diff shown here.
                  </Callout>
                )}
                {(diffViewMode === "single" ? mergedDiffs : stepDiffs)
                  .length === 0 ? (
                  <Text color="text-low">
                    No changes between these revisions.
                  </Text>
                ) : (
                  <Flex direction="column" gap="4">
                    {(diffViewMode === "single" ? mergedDiffs : stepDiffs).map(
                      (d) => (
                        <ExpandableDiff
                          key={d.title}
                          title={d.title}
                          a={d.a}
                          b={d.b}
                          defaultOpen
                        />
                      ),
                    )}
                  </Flex>
                )}
              </>
            </>
          )}
        </Box>
      </Flex>
    </Modal>
  );
}
