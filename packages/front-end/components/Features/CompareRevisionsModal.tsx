import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { datetime } from "shared/dates";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import { Select, SelectItem } from "@/ui/Select";
import Switch from "@/ui/Switch";
import LoadingOverlay from "@/components/LoadingOverlay";
import EventUser from "@/components/Avatar/EventUser";
import {
  useFeatureRevisionDiff,
  FeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import { ExpandableDiff } from "./DraftModal";
import styles from "./CompareRevisionsModal.module.scss";

const DRAFT_STATUSES = new Set([
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
]);

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

function getRevisionStatusBadge(
  revision: MinimalFeatureRevisionInterface,
  liveVersion: number,
) {
  if (revision.version === liveVersion) {
    return <Badge label="Live" radius="full" color="teal" />;
  }
  switch (revision.status) {
    case "draft":
      return <Badge label="Draft" radius="full" color="indigo" />;
    case "published":
      return <Badge label="Locked" radius="full" color="gray" />;
    case "discarded":
      return <Badge label="Discarded" radius="full" color="red" />;
    case "pending-review":
    case "changes-requested":
    case "approved":
      return <Badge label={revision.status} radius="full" color="gray" />;
    default:
      return null;
  }
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

  const [showDiscarded, setShowDiscarded] = useState(false);
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
  const [diffViewMode, setDiffViewMode] = useState<"steps" | "single">("steps");
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

  const revisionListByVersion = useMemo(
    () => new Map(filteredRevisionList.map((r) => [r.version, r])),
    [filteredRevisionList],
  );

  const mostRecentDraftVersion = useMemo(() => {
    const drafts = filteredRevisionList.filter((r) =>
      DRAFT_STATUSES.has(r.status),
    );
    if (drafts.length === 0) return null;
    return Math.max(...drafts.map((r) => r.version));
  }, [filteredRevisionList]);

  const quickActionRanges = useMemo(() => {
    const draftRange: number[] | null =
      mostRecentDraftVersion != null &&
      mostRecentDraftVersion !== liveVersion &&
      versionsAsc.includes(liveVersion) &&
      versionsAsc.includes(mostRecentDraftVersion)
        ? versionsAsc.filter(
            (v) => v >= liveVersion && v <= mostRecentDraftVersion,
          )
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
          style={{ width: 360, minWidth: 320, minHeight: 0 }}
          className={`${styles.sidebar} border-end overflow-auto`}
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
                        Revisions {quickActionRanges.draftRange[0]} →{" "}
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
                        Revisions {quickActionRanges.liveRange[0]} →{" "}
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
                        Revisions {quickActionRanges.allRange[0]} →{" "}
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
                      <Checkbox
                        id={rowId}
                        value={isSelected}
                        setValue={() => toggleVersion(v)}
                      />
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
                          {minRev &&
                            getRevisionStatusBadge(minRev, liveVersion)}
                        </Flex>
                        {date && minRev && (
                          <Text size="small" color="text-low">
                            {datetime(date)} ·{" "}
                            <EventUser user={minRev.createdBy} display="name" />
                          </Text>
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
          ) : anyLoading && !allLoaded ? (
            <LoadingOverlay />
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
                    <Heading as="h2" size="small" mb="0">
                      Revision {selectedSorted[0]} → Revision{" "}
                      {selectedSorted[selectedSorted.length - 1]}
                    </Heading>
                  )}
                </Flex>
                <Flex align="center" gap="2">
                  <Text size="medium" weight="medium" color="text-mid">
                    Show diff as
                  </Text>
                  <Select
                    value={diffViewMode}
                    setValue={(v) => setDiffViewMode(v as "steps" | "single")}
                    disabled={!canToggleDiffView}
                    size="2"
                    mb="0"
                  >
                    <SelectItem value="steps">Steps</SelectItem>
                    <SelectItem value="single">Single diff</SelectItem>
                  </Select>
                </Flex>
              </Flex>
              {diffViewMode === "single" ? (
                selectedSorted.length < 2 ? (
                  <Text color="text-low">
                    Select at least two revisions to see the merged diff.
                  </Text>
                ) : singleRevFirst && singleRevLast ? (
                  mergedDiffs.length === 0 ? (
                    <Text color="text-low">
                      No changes between Revision {selectedSorted[0]} and
                      Revision {selectedSorted[selectedSorted.length - 1]}.
                    </Text>
                  ) : (
                    <Flex direction="column" gap="1">
                      {mergedDiffs.map((d) => (
                        <ExpandableDiff
                          key={d.title}
                          title={d.title}
                          a={d.a}
                          b={d.b}
                          defaultOpen
                        />
                      ))}
                    </Flex>
                  )
                ) : (
                  <LoadingOverlay />
                )
              ) : (
                <>
                  {currentStep && (
                    <Text size="large" color="text-high" mb="3" as="p">
                      Revision {currentStep[0]} → Revision {currentStep[1]}
                    </Text>
                  )}
                  {stepRevA && stepRevB && stepDiffs.length === 0 ? (
                    <Text color="text-low">
                      No changes between these revisions.
                    </Text>
                  ) : (
                    <Flex direction="column" gap="1">
                      {stepDiffs.map((d) => (
                        <ExpandableDiff
                          key={d.title}
                          title={d.title}
                          a={d.a}
                          b={d.b}
                          defaultOpen
                        />
                      ))}
                    </Flex>
                  )}
                </>
              )}
            </>
          )}
        </Box>
      </Flex>
    </Modal>
  );
}
