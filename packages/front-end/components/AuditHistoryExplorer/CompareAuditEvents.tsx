import React, { useState } from "react";
// eslint-disable-next-line no-restricted-imports
import { Box, Checkbox as RadixCheckbox, Flex } from "@radix-ui/themes";
import {
  PiArrowsLeftRightBold,
  PiCaretDownBold,
  PiCaretRightFill,
  PiCheckBold,
  PiClockClockwise,
  PiWarningBold,
  PiX,
} from "react-icons/pi";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { datetime } from "shared/dates";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import LoadingOverlay from "@/components/LoadingOverlay";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import { ExpandableDiff } from "@/components/Features/DraftModal";
import { PAGE_LIMIT, UseAuditEntriesResult } from "./useAuditEntries";
import { AuditDiffConfig, CoarsenedAuditEntry } from "./types";
import {
  COMPACT_DIFF_STYLES,
  LeftColItem,
  getSeparatorBucketKey,
  getSeparatorLabel,
} from "./CompareAuditEventsUtils";
import { useAuditComparison } from "./useAuditComparison";
import styles from "./CompareAuditEvents.module.scss";

function EntryUserName({
  user,
}: {
  user: CoarsenedAuditEntry<unknown>["user"];
}) {
  if (user.type === "system") return <>System</>;
  if (user.type === "apikey") return <>API Key</>;
  return <>{user.name || user.email || "Unknown user"}</>;
}

function AuditEntryCompareLabel({
  entryA,
  entryB,
  labelA,
  labelB,
  entryAFailed = false,
  entryBFailed = false,
  mb,
  mt,
}: {
  entryA: CoarsenedAuditEntry<unknown> | null;
  entryB: CoarsenedAuditEntry<unknown> | null;
  labelA: string;
  labelB: string;
  entryAFailed?: boolean;
  entryBFailed?: boolean;
  mb?: "1" | "2" | "3" | "4";
  mt?: "1" | "2" | "3" | "4";
}) {
  return (
    <Flex align="center" gap="4" wrap="nowrap" mb={mb} mt={mt}>
      <Flex direction="column">
        <Flex align="center" gap="1">
          {entryAFailed && (
            <Tooltip body="Could not load entry">
              <PiWarningBold style={{ color: "var(--red-9)", flexShrink: 0 }} />
            </Tooltip>
          )}
          <Text weight="semibold" size="medium">
            {labelA}
          </Text>
        </Flex>
        {entryA && (
          <Text as="div" size="small" color="text-low">
            {datetime(entryA.dateStart)} · <EntryUserName user={entryA.user} />
          </Text>
        )}
      </Flex>
      <PiArrowsLeftRightBold size={16} />
      <Flex direction="column">
        <Flex align="center" gap="1">
          {entryBFailed && (
            <Tooltip body="Could not load entry">
              <PiWarningBold style={{ color: "var(--red-9)", flexShrink: 0 }} />
            </Tooltip>
          )}
          <Text weight="semibold" size="medium">
            {labelB}
          </Text>
        </Flex>
        {entryB && (
          <Text as="div" size="small" color="text-low">
            {datetime(entryB.dateStart)} · <EntryUserName user={entryB.user} />
          </Text>
        )}
      </Flex>
    </Flex>
  );
}

function RawAuditDetails({ entry }: { entry: CoarsenedAuditEntry<unknown> }) {
  const [open, setOpen] = useState(false);
  const pre = JSON.stringify(entry.preSnapshot ?? {}, null, 2);
  const post = JSON.stringify(entry.postSnapshot, null, 2);

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
        Full audit record
      </div>
      {open && (
        <Box mt="3">
          <Flex direction="column" gap="1" mb="4">
            {(
              [
                [
                  "Event",
                  <Badge
                    key="e"
                    label={entry.event}
                    color="violet"
                    variant="soft"
                    radius="full"
                  />,
                ],
                ["Date", datetime(entry.dateStart)],
                [
                  "Author",
                  entry.user.type === "system"
                    ? "System"
                    : entry.user.type === "apikey"
                      ? `API Key (${entry.user.apiKey ?? ""})`
                      : entry.user.name || entry.user.email || "Unknown",
                ],
                ...(entry.count > 1
                  ? [["Merged events", String(entry.count)]]
                  : []),
              ] as [string, React.ReactNode][]
            ).map(([label, value]) => (
              <Flex key={label} gap="2" align="baseline">
                <span style={{ minWidth: 80, flexShrink: 0 }}>
                  <Text size="medium" color="text-mid">
                    {label}
                  </Text>
                </span>
                <Text size="medium">{value}</Text>
              </Flex>
            ))}
          </Flex>
          <Text size="medium" weight="medium" color="text-mid" mb="1" as="div">
            Details
          </Text>
          <div className="diff-wrapper">
            <div className="list-group-item list-group-item-light">
              <ReactDiffViewer
                oldValue={pre}
                newValue={post}
                compareMethod={DiffMethod.LINES}
                styles={COMPACT_DIFF_STYLES}
              />
            </div>
          </div>
        </Box>
      )}
    </Box>
  );
}

export interface CompareAuditEventsProps<T> {
  config: AuditDiffConfig<T>;
  auditEntries: UseAuditEntriesResult<T>;
  /** Human-readable map from event string to display name, e.g. "experiment.start" → "Started" */
  eventLabels?: Record<string, string>;
}

const EMPTY_EVENT_LABELS: Record<string, string> = {};

export default function CompareAuditEvents<T>({
  config,
  auditEntries,
  eventLabels = EMPTY_EVENT_LABELS,
}: CompareAuditEventsProps<T>) {
  const { allAuditEvents } = auditEntries;
  const {
    sectionLabels,
    setVisibleSections,
    isSectionVisible,
    toggleSection,
    loading,
    loadingAll,
    error,
    hasMore,
    total,
    loadMore,
    handleLoadAll,
    handleLoadAllThen,
    groupBy,
    setGroupBy,
    flatEntries,
    flatIds,
    leftColumnItems,
    getEntryLabel,
    isEntryFailed,
    expandGroup,
    selectedIds,
    selectedSorted,
    selectedSortedSet,
    toggleSelection,
    viewSingle,
    applyQuickAction,
    steps,
    safeDiffPage,
    setDiffPage,
    diffViewMode,
    setDiffViewModeRaw,
    activeDiffs,
    customRenderGroups,
    displayFailed,
    stepEntryA,
    stepEntryB,
    singleEntryFirst,
    singleEntryLast,
    isSingleEntry,
  } = useAuditComparison(config, auditEntries, eventLabels);

  // Tracks which time-range quick action is currently loading (key = range label).
  const [pendingRange, setPendingRange] = useState<string | null>(null);

  /**
   * Returns [newestId, oldestId] for all entries whose dateEnd falls at or
   * after `cutoffMs`, or null if fewer than one entry qualifies.
   */
  function getWindowSelection(
    entries: CoarsenedAuditEntry<T>[],
    cutoffMs: number,
  ): [string, string] | null {
    const inWindow = entries.filter((e) => e.dateEnd.getTime() >= cutoffMs);
    if (!inWindow.length) return null;
    return [inWindow[0].id, inWindow[inWindow.length - 1].id];
  }

  /** Returns true when the current selection matches the time-range window. */
  function isWindowActive(cutoffMs: number): boolean {
    if (hasMore) return false;
    const sel = getWindowSelection(flatEntries, cutoffMs);
    if (!sel) return false;
    return (
      selectedSorted[0] === sel[0] &&
      selectedSorted[selectedSorted.length - 1] === sel[1]
    );
  }

  async function handleTimeRangeAction(label: string, cutoffMs: number) {
    // If the oldest loaded entry predates the cutoff we already have everything
    // we need; otherwise load all pages first.
    const oldestLoaded =
      flatEntries.length > 0
        ? flatEntries[flatEntries.length - 1].dateEnd.getTime()
        : Infinity;
    if (hasMore && oldestLoaded > cutoffMs) {
      setPendingRange(label);
      await handleLoadAllThen((entries) => {
        const sel = getWindowSelection(entries, cutoffMs);
        return sel ? [sel[0], sel[1]] : null;
      });
      setPendingRange(null);
    } else {
      const sel = getWindowSelection(flatEntries, cutoffMs);
      if (sel) applyQuickAction([sel[0], sel[1]]);
    }
  }

  const renderEntryRow = (entry: CoarsenedAuditEntry<T>) => {
    const isSelected = selectedSortedSet.has(entry.id);
    const isExclusivelySelected =
      selectedIds[0] === entry.id &&
      selectedIds[selectedIds.length - 1] === entry.id;
    const failed = isEntryFailed(entry.id);

    return (
      <Box
        key={entry.id}
        className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
        onClick={() => toggleSelection(entry.id)}
      >
        {!isExclusivelySelected && (
          <div className={styles.viewSingleWrapper}>
            <Button
              variant="outline"
              size="xs"
              className={styles.viewSingleButton}
              onClick={async (e) => {
                e?.preventDefault();
                e?.stopPropagation();
                viewSingle(entry.id);
              }}
            >
              View
            </Button>
          </div>
        )}
        <div
          className={styles.filterCheckbox}
          style={{ marginTop: -6, marginLeft: -6 }}
          onClick={(e) => {
            e.stopPropagation();
            toggleSelection(entry.id);
          }}
        >
          <RadixCheckbox
            checked={isSelected}
            style={{ pointerEvents: "none" }}
          />
        </div>
        <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
          <Flex align="center" justify="between" gap="2" width="100%">
            <Flex align="center" gap="1">
              {isSelected && failed && (
                <Tooltip body="Could not load entry">
                  <PiWarningBold
                    style={{ color: "var(--red-9)", flexShrink: 0 }}
                  />
                </Tooltip>
              )}
              <Text weight="semibold">{getEntryLabel(entry)}</Text>
            </Flex>
            {entry.count > 1 && (
              <Badge
                label={String(entry.count)}
                color="violet"
                variant="soft"
                title={`${entry.count} changes merged`}
              />
            )}
          </Flex>
          <Text size="small" color="text-low">
            {entry.count > 1
              ? datetime(entry.dateEnd)
              : datetime(entry.dateStart)}{" "}
            · <EntryUserName user={entry.user} />
          </Text>
          {entry.count > 1 && (
            <Box mt="1">
              <Link
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  expandGroup(entry);
                }}
              >
                <PiCaretDownBold
                  style={{ display: "inline", marginRight: 4 }}
                />
                {`Expand ${entry.count} changes`}
              </Link>
            </Box>
          )}
        </Flex>
      </Box>
    );
  };

  return (
    <Flex style={{ flex: 1, minHeight: 0, height: "100%" }}>
      {/* Left column */}
      <Box
        style={{ width: 300, minWidth: 300, minHeight: 0 }}
        className={`${styles.sidebar} ${styles.sidebarLeft} overflow-auto`}
      >
        {/* Quick actions */}
        {flatEntries.length >= 2 && (
          <Box className={`${styles.section} border-bottom`} pb="2">
            <Text size="medium" weight="medium" color="text-mid" mb="2" as="p">
              Quick actions
            </Text>
            <Flex direction="column" className={styles.quickActionsList}>
              {/* Most recent change */}
              <Box
                className={`${styles.row} ${
                  selectedSorted.length === 2 &&
                  selectedSorted[0] === flatEntries[0].id &&
                  selectedSorted[1] === flatEntries[1].id
                    ? styles.rowSelected
                    : ""
                }`}
                onClick={() =>
                  applyQuickAction([flatEntries[0].id, flatEntries[1].id])
                }
              >
                <Box className={styles.rowSpacer} />
                <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                  <Text weight="semibold">Most recent change</Text>
                  <Text size="small" color="text-low" as="div">
                    <span
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        width: "100%",
                      }}
                    >
                      {getEntryLabel(flatEntries[0])}
                    </span>
                  </Text>
                </Flex>
              </Box>

              {/* Time-range quick actions */}
              {(
                [
                  { label: "Past day", ms: 24 * 60 * 60 * 1000 },
                  { label: "Past week", ms: 7 * 24 * 60 * 60 * 1000 },
                  { label: "Past month", ms: 30 * 24 * 60 * 60 * 1000 },
                ] as const
              ).map(({ label, ms }) => {
                const cutoff = Date.now() - ms;
                const isActive = isWindowActive(cutoff);
                const isPending = pendingRange === label;
                return (
                  <Box
                    key={label}
                    className={`${styles.row} ${isActive ? styles.rowSelected : ""}`}
                    onClick={() => handleTimeRangeAction(label, cutoff)}
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex align="center" gap="2">
                      <Text weight="semibold">{label}</Text>
                      {isPending && <LoadingSpinner />}
                    </Flex>
                  </Box>
                );
              })}

              {/* All changes */}
              <Box
                className={`${styles.row} ${
                  selectedSorted.length === flatIds.length && !hasMore
                    ? styles.rowSelected
                    : ""
                }`}
                onClick={async () => {
                  if (hasMore) {
                    await handleLoadAll();
                  } else {
                    applyQuickAction([flatIds[0], flatIds[flatIds.length - 1]]);
                  }
                }}
              >
                <Box className={styles.rowSpacer} />
                <Flex direction="column" gap="1">
                  <Flex align="center" gap="2">
                    <Text weight="semibold">All changes</Text>
                    {loadingAll && !pendingRange && <LoadingSpinner />}
                  </Flex>
                  <Text size="small" color="text-low">
                    {total} total
                  </Text>
                </Flex>
              </Box>
            </Flex>
          </Box>
        )}

        {/* Group by + entry list */}
        <Box className={styles.section} pb="3">
          <Flex align="center" justify="between" mb="2">
            <Text size="medium" weight="medium" color="text-mid">
              Select a range of changes
            </Text>
            {!config.hideFilters &&
              sectionLabels.length > 0 &&
              (() => {
                const defaultHidden = new Set(
                  config.defaultHiddenSections ?? [],
                );
                const isDefaultVisible = (l: string) => !defaultHidden.has(l);
                const activeFilterCount = sectionLabels.filter(
                  (l) => !isSectionVisible(l),
                ).length;
                const isShowingAll = activeFilterCount === 0;
                const isAtDefault = sectionLabels.every(
                  (l) => isSectionVisible(l) === isDefaultVisible(l),
                );
                return (
                  <DropdownMenu
                    modal={true}
                    trigger={
                      <Link>
                        Filters
                        {activeFilterCount > 0 && (
                          <Badge
                            color="indigo"
                            variant="solid"
                            radius="full"
                            label={String(activeFilterCount)}
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
                          setVisibleSections(
                            sectionLabels.reduce<Record<string, boolean>>(
                              (acc, l) => ({ ...acc, [l]: true }),
                              {},
                            ),
                          );
                        }}
                      >
                        <Flex align="center" gap="1">
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
                        setVisibleSections(
                          sectionLabels.reduce<Record<string, boolean>>(
                            (acc, l) => ({
                              ...acc,
                              [l]: isDefaultVisible(l),
                            }),
                            {},
                          ),
                        );
                      }}
                    >
                      <Flex align="center" gap="1">
                        <span style={{ width: 24, display: "inline-flex" }}>
                          <PiClockClockwise size={16} />
                        </span>
                        {isAtDefault
                          ? "Using default filters"
                          : "Use default filters"}
                      </Flex>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {sectionLabels.map((label) => {
                      const isOnlyVisible =
                        isSectionVisible(label) &&
                        sectionLabels.every(
                          (l) => l === label || !isSectionVisible(l),
                        );
                      return (
                        <DropdownMenuItem
                          key={label}
                          // Row click = show only this section
                          onClick={() => {
                            if (!isOnlyVisible) {
                              setVisibleSections(
                                sectionLabels.reduce<Record<string, boolean>>(
                                  (acc, l) => ({ ...acc, [l]: l === label }),
                                  {},
                                ),
                              );
                            }
                          }}
                        >
                          <Flex align="center" gap="1">
                            <div
                              className={`rt-CheckboxItem ${styles.filterCheckbox}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSection(label);
                              }}
                            >
                              <RadixCheckbox
                                checked={isSectionVisible(label)}
                                color="violet"
                              />
                            </div>
                            Show {label}
                          </Flex>
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Group items by</DropdownMenuLabel>
                    {(["minute", "hour", "day"] as const).map((opt) => (
                      <DropdownMenuItem
                        key={opt}
                        onClick={() => setGroupBy(opt)}
                      >
                        <Flex align="center" gap="1">
                          <span style={{ width: 24, display: "inline-flex" }}>
                            {groupBy === opt && <PiCheckBold size={14} />}
                          </span>
                          {opt.charAt(0).toUpperCase() + opt.slice(1)}
                        </Flex>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenu>
                );
              })()}
          </Flex>

          {loading && !flatEntries.length ? (
            <LoadingOverlay />
          ) : error ? (
            <Callout status="error">{error}</Callout>
          ) : flatEntries.length === 0 ? (
            <Text color="text-low">No change history found.</Text>
          ) : (
            <Flex direction="column" className={styles.revisionsList}>
              {(leftColumnItems as LeftColItem<T>[]).reduce<React.ReactNode[]>(
                (nodes, item, i) => {
                  const prev = leftColumnItems[i - 1] as LeftColItem<T>;
                  const getItemDate = (it: LeftColItem<T>) =>
                    it.type === "entry"
                      ? it.entry.dateStart
                      : it.type === "marker"
                        ? it.marker.date
                        : it.date;
                  const date = getItemDate(item);
                  const prevDate = prev ? getItemDate(prev) : null;
                  const bucketKey = getSeparatorBucketKey(date);
                  const prevBucketKey = prevDate
                    ? getSeparatorBucketKey(prevDate)
                    : null;
                  if (prevBucketKey === null || bucketKey !== prevBucketKey) {
                    nodes.push(
                      <Flex
                        key={`sep-${i}`}
                        align="center"
                        gap="2"
                        px="2"
                        py="1"
                        style={{ width: 200 }}
                      >
                        <Box
                          style={{
                            flex: 1,
                            height: 1,
                            background: "var(--gray-6)",
                          }}
                        />
                        <Text size="small" weight="medium" color="text-low">
                          {getSeparatorLabel(date)}
                        </Text>
                        <Box
                          style={{
                            flex: 1,
                            height: 1,
                            background: "var(--gray-6)",
                          }}
                        />
                      </Flex>,
                    );
                  }
                  if (item.type === "entry") {
                    nodes.push(renderEntryRow(item.entry));
                  } else if (item.type === "marker") {
                    nodes.push(
                      <Flex
                        key={`marker-${item.marker.id}`}
                        align="center"
                        px="2"
                        py="1"
                      >
                        <Text color="text-low" size="small">
                          {item.marker.label}
                        </Text>
                      </Flex>,
                    );
                  } else {
                    // Noise item: hidden diffable changes + collapsed markers.
                    const lines: string[] = [];
                    if (item.hiddenCount > 0) {
                      lines.push(
                        `${item.hiddenCount} ${item.hiddenCount === 1 ? "change" : "changes"} hidden`,
                      );
                    }
                    for (const m of item.markers) {
                      lines.push(
                        m.count > 1 ? `${m.label} ×${m.count}` : m.label,
                      );
                    }
                    nodes.push(
                      <Flex
                        key={`noise-${i}`}
                        direction="column"
                        gap="1"
                        px="2"
                        py="1"
                      >
                        {lines.map((line) => (
                          <Flex key={line} align="center">
                            <Text color="text-low" size="small">
                              {line}
                            </Text>
                          </Flex>
                        ))}
                      </Flex>,
                    );
                  }
                  return nodes;
                },
                [],
              )}
              {hasMore &&
                (() => {
                  const remaining = Math.max(0, total - allAuditEvents.length);
                  if (remaining === 0) return null;
                  const loadMoreCount = Math.min(PAGE_LIMIT, remaining);
                  return (
                    <Flex gap="4" mt="1" justify="between">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={loadMore}
                        disabled={loading || loadingAll}
                      >
                        {loading && <LoadingSpinner />}
                        {`Load ${loadMoreCount} more`}
                      </Button>
                      {remaining > PAGE_LIMIT && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={handleLoadAll}
                          disabled={loading || loadingAll}
                        >
                          {loadingAll && <LoadingSpinner />}
                          {`Load all (${total})`}
                        </Button>
                      )}
                    </Flex>
                  );
                })()}
            </Flex>
          )}
        </Box>
      </Box>

      {/* Right column */}
      <Box
        flexGrow="1"
        position="relative"
        className={`${styles.sidebar} overflow-auto`}
        style={{ minHeight: 0 }}
      >
        {steps.length === 0 && !isSingleEntry ? (
          <Text color="text-low">
            Select at least one entry in the list to see the diff.
          </Text>
        ) : (
          <Box pb="4">
            {/* Header row */}
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
                  {diffViewMode === "single" &&
                    singleEntryFirst &&
                    singleEntryLast &&
                    (isSingleEntry ? (
                      <Flex direction="column">
                        <Flex align="center" gap="1">
                          {isEntryFailed(singleEntryFirst.id) && (
                            <Tooltip body="Could not load entry">
                              <PiWarningBold
                                style={{
                                  color: "var(--red-9)",
                                  flexShrink: 0,
                                }}
                              />
                            </Tooltip>
                          )}
                          <Text weight="semibold" size="medium">
                            {getEntryLabel(singleEntryFirst)}
                          </Text>
                        </Flex>
                        <Text as="div" size="small" color="text-low">
                          {datetime(singleEntryFirst.dateStart)} ·{" "}
                          <EntryUserName user={singleEntryFirst.user} />
                        </Text>
                      </Flex>
                    ) : (
                      <AuditEntryCompareLabel
                        entryA={singleEntryFirst}
                        entryB={singleEntryLast}
                        labelA={getEntryLabel(singleEntryFirst)}
                        labelB={getEntryLabel(singleEntryLast)}
                        entryAFailed={isEntryFailed(singleEntryFirst.id)}
                        entryBFailed={isEntryFailed(singleEntryLast.id)}
                      />
                    ))}
                </Flex>
                {!isSingleEntry && (
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
                )}
              </Flex>

              {/* Step label */}
              {diffViewMode === "steps" && stepEntryA && stepEntryB && (
                <AuditEntryCompareLabel
                  entryA={stepEntryA}
                  entryB={stepEntryB}
                  labelA={getEntryLabel(stepEntryA)}
                  labelB={getEntryLabel(stepEntryB)}
                  entryAFailed={isEntryFailed(stepEntryA.id)}
                  entryBFailed={isEntryFailed(stepEntryB.id)}
                  mt="3"
                />
              )}
            </Box>

            {/* Diff content */}
            {displayFailed.length > 0 ? (
              <Callout status="error" contentsAs="div" mt="4">
                <Flex direction="column" gap="2" align="start">
                  <span>
                    Could not load change
                    {displayFailed.length > 1 ? "s" : ""}.
                  </span>
                  <span>The audit record may be missing snapshot data.</span>
                </Flex>
              </Callout>
            ) : activeDiffs.length === 0 ? (
              <Text color="text-low">No changes between these entries.</Text>
            ) : (
              <>
                {/* Hoisted summaries: human-readable render per section */}
                {customRenderGroups.length > 0 && (
                  <Box>
                    <Heading as="h5" size="small" color="text-mid" mt="4">
                      Summary of changes
                    </Heading>
                    <Flex direction="column" gap="0">
                      {customRenderGroups.map(({ label, renders }) => (
                        <Box
                          key={label}
                          p="3"
                          my="3"
                          className="rounded bg-light"
                        >
                          <Heading as="h6" size="small" color="text-mid" mb="2">
                            {label}
                          </Heading>
                          {renders.map((r, i) => (
                            <Box key={i}>{r}</Box>
                          ))}
                        </Box>
                      ))}
                    </Flex>
                  </Box>
                )}

                {/* Raw JSON diffs */}
                {customRenderGroups.length > 0 && (
                  <Heading as="h5" size="small" color="text-mid" mt="4" mb="3">
                    Change details
                  </Heading>
                )}
                <Flex
                  direction="column"
                  gap="4"
                  key={`${stepEntryA?.id ?? singleEntryFirst?.id}-${stepEntryB?.id ?? singleEntryLast?.id}`}
                >
                  {activeDiffs.map((d, i) => (
                    <Box key={i}>
                      <ExpandableDiff
                        title={d.label}
                        a={d.a}
                        b={d.b}
                        defaultOpen={
                          !d.defaultCollapsed && isSectionVisible(d.label)
                        }
                        styles={COMPACT_DIFF_STYLES}
                      />
                    </Box>
                  ))}
                </Flex>
              </>
            )}
            {singleEntryLast &&
              (isSingleEntry ||
                diffViewMode === "steps" ||
                selectedSorted.length === 2) && (
                <RawAuditDetails entry={singleEntryLast} />
              )}
          </Box>
        )}
      </Box>
    </Flex>
  );
}
