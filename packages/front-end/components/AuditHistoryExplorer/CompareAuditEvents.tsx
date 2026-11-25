import React, { useState } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
import { DiffMethod } from "react-diff-viewer-continued";
import { datetime } from "shared/dates";
import LazyDiffViewer from "@/components/AuditHistoryExplorer/LazyDiffViewer";
import EventUser from "@/components/Avatar/EventUser";
import { auditUserInfoToEventUser } from "@/components/Avatar/auditUserToEventUser";
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
import SplitButton from "@/ui/SplitButton";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Code from "@/components/SyntaxHighlighting/Code";
import LoadingOverlay from "@/components/LoadingOverlay";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Badge from "@/ui/Badge";
import {
  ExpandableDiff,
  useDiffFormat,
  DiffFormatToggle,
  stringifyForRawDiff,
} from "@/components/Reviews/Feature/RevisionDiffUtils";
import { PAGE_LIMIT, UseAuditEntriesResult } from "./useAuditEntries";
import { AuditDiffConfig, CoarsenedAuditEntry, DisplayText } from "./types";
import {
  COMPACT_DIFF_STYLES,
  LeftColItem,
  diffLabelText,
  getSeparatorBucketKey,
  getSeparatorLabel,
  resolveDisplayText,
  sectionLabelText,
} from "./CompareAuditEventsUtils";
import { useAuditComparison } from "./useAuditComparison";
import styles from "./CompareAuditEvents.module.scss";

function AuditEntryAuthor({
  user,
  display = "avatar-name-email",
}: {
  user: CoarsenedAuditEntry<unknown>["user"];
  display?: "avatar-name" | "avatar-name-email";
}) {
  return (
    <EventUser
      user={auditUserInfoToEventUser(user)}
      display={display}
      size="sm"
      wrap={true}
    />
  );
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
  const { t } = useLingui();
  return (
    <Flex align="start" gap="4" wrap="nowrap" mb={mb} mt={mt}>
      <Flex direction="column">
        <Flex align="center" gap="1">
          {entryAFailed && (
            <Tooltip body={t`Could not load entry`}>
              <PiWarningBold style={{ color: "var(--red-9)", flexShrink: 0 }} />
            </Tooltip>
          )}
          <Text weight="semibold" size="lg">
            {labelA}
          </Text>
        </Flex>
        {entryA && (
          <Box mt="2">
            <AuditEntryAuthor user={entryA.user} />
          </Box>
        )}
        {entryA && <Text as="div">{datetime(entryA.dateStart)}</Text>}
      </Flex>
      <PiArrowsLeftRightBold
        size={16}
        style={{ flexShrink: 0, marginTop: 4 }}
      />
      <Flex direction="column">
        <Flex align="center" gap="1">
          {entryBFailed && (
            <Tooltip body={t`Could not load entry`}>
              <PiWarningBold style={{ color: "var(--red-9)", flexShrink: 0 }} />
            </Tooltip>
          )}
          <Text weight="semibold" size="lg">
            {labelB}
          </Text>
        </Flex>
        {entryB && (
          <Box mt="2">
            <AuditEntryAuthor user={entryB.user} />
          </Box>
        )}
        {entryB && <Text as="div">{datetime(entryB.dateStart)}</Text>}
      </Flex>
    </Flex>
  );
}

function RawAuditDetails({ entry }: { entry: CoarsenedAuditEntry<unknown> }) {
  const { t } = useLingui();
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
        <Trans>Full audit record</Trans>
      </div>
      {open && (
        <Box mt="3">
          <Flex direction="column" gap="1" mb="4">
            {(
              [
                [
                  t`Event`,
                  <Badge
                    key="e"
                    label={entry.event}
                    color="violet"
                    variant="soft"
                    radius="full"
                  />,
                ],
                [t`Date`, datetime(entry.dateStart)],
                [
                  t`Author`,
                  <AuditEntryAuthor key="author" user={entry.user} />,
                ],
                ...(entry.count > 1
                  ? [[t`Merged events`, String(entry.count)]]
                  : []),
              ] as [string, React.ReactNode][]
            ).map(([label, value]) => (
              <Flex key={label} gap="2" align="baseline">
                <span style={{ minWidth: 80, flexShrink: 0 }}>
                  <Text size="md" color="text-mid">
                    {label}
                  </Text>
                </span>
                <Text size="md">{value}</Text>
              </Flex>
            ))}
          </Flex>
          <Text size="md" weight="medium" color="text-mid" mb="1" as="div">
            <Trans>Details</Trans>
          </Text>
          <div className="diff-wrapper">
            <div className="list-group-item list-group-item-light">
              <LazyDiffViewer
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
  eventLabels?: Record<string, DisplayText>;
  /**
   * Optional "revert to this version" action. When provided, a CTA is shown
   * while viewing a single entry; `onRevert` receives that entry (its
   * `postSnapshot` is the state to restore).
   */
  revert?: {
    cta: string;
    disabled?: boolean;
    confirmTitle?: string;
    confirmBody?: React.ReactNode;
    onRevert: (entry: CoarsenedAuditEntry<T>) => void | Promise<void>;
  };
}

const EMPTY_EVENT_LABELS: Record<string, DisplayText> = {};

// `key` names the range in state; `label` is what's shown.
const TIME_RANGE_ACTIONS: {
  key: string;
  label: MessageDescriptor;
  ms: number;
}[] = [
  { key: "Past day", label: msg`Past day`, ms: 24 * 60 * 60 * 1000 },
  { key: "Past week", label: msg`Past week`, ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "Past month", label: msg`Past month`, ms: 30 * 24 * 60 * 60 * 1000 },
];

const GROUP_BY_LABELS: Record<"minute" | "hour" | "day", MessageDescriptor> = {
  minute: msg`Minute`,
  hour: msg`Hour`,
  day: msg`Day`,
};

export default function CompareAuditEvents<T>({
  config,
  auditEntries,
  eventLabels = EMPTY_EVENT_LABELS,
  revert,
}: CompareAuditEventsProps<T>) {
  const { t, i18n } = useLingui();
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
    activeRawPre,
    activeRawPost,
    customRenderGroups,
    activeBadges,
    displayFailed,
    stepEntryA,
    stepEntryB,
    singleEntryFirst,
    singleEntryLast,
    isSingleEntry,
    comparisonBase,
    setComparisonBase,
  } = useAuditComparison(config, auditEntries, eventLabels);

  // Tracks which time-range quick action is currently loading (key = range label).
  const [pendingRange, setPendingRange] = useState<string | null>(null);

  const singleSelect = !!config.singleSelect;
  const contentView = config.contentView;
  // The focused content view is the default when configured.
  const [showContent, setShowContent] = useState(!!contentView);

  const [confirmRevertEntry, setConfirmRevertEntry] =
    useState<CoarsenedAuditEntry<T> | null>(null);

  // App-wide preference: human-readable renders vs raw JSON diffs.
  const [format, setFormat] = useDiffFormat();
  // The contentView toggle only offers formatted/json, but `format` is a shared
  // preference that can be "raw" from another surface — coerce so we never land
  // on a view the toggle can't switch away from.
  const effectiveFormat =
    contentView && format === "raw" ? "formatted" : format;

  /**
   * Returns [newestId, oldestId] for the time window: all entries whose dateEnd
   * is at or after `cutoffMs`, plus the immediately older entry so the diff
   * shows the full "before → after" (e.g. [Feb 2, Jan 21] for the change that
   * happened within the past month). Returns null if fewer than one entry
   * qualifies.
   */
  function getWindowSelection(
    entries: CoarsenedAuditEntry<T>[],
    cutoffMs: number,
  ): [string, string] | null {
    const inWindow = entries.filter((e) => e.dateEnd.getTime() >= cutoffMs);
    if (!inWindow.length) return null;
    const newestId = inWindow[0].id;
    const oldestInWindow = inWindow[inWindow.length - 1];
    const oldestInWindowIdx = entries.findIndex(
      (e) => e.id === oldestInWindow.id,
    );
    const includeOlderEndpoint =
      oldestInWindowIdx >= 0 && oldestInWindowIdx + 1 < entries.length;
    const oldestId = includeOlderEndpoint
      ? entries[oldestInWindowIdx + 1].id
      : oldestInWindow.id;
    return [newestId, oldestId];
  }

  // Returns true when the current selection matches the time-range window.
  // The window can only be matched when we have enough loaded data to resolve it
  // (all pages loaded, OR the oldest loaded entry already predates the cutoff).
  function isWindowActive(cutoffMs: number): boolean {
    const oldestLoaded =
      flatEntries.length > 0
        ? flatEntries[flatEntries.length - 1].dateEnd.getTime()
        : Infinity;
    if (hasMore && oldestLoaded > cutoffMs) return false;
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
        onClick={() =>
          singleSelect ? viewSingle(entry.id) : toggleSelection(entry.id)
        }
      >
        {!singleSelect && !isExclusivelySelected && (
          <div className={styles.viewSingleWrapper}>
            <Button
              variant="outline"
              size="sm"
              className={styles.viewSingleButton}
              onClick={async (e) => {
                e?.preventDefault();
                e?.stopPropagation();
                viewSingle(entry.id);
              }}
            >
              <Trans>View</Trans>
            </Button>
          </div>
        )}
        {!singleSelect && (
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
        )}
        <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
          <Flex align="center" justify="between" gap="2" width="100%">
            <Flex align="center" gap="1">
              {isSelected && failed && (
                <Tooltip body={t`Could not load entry`}>
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
                title={t`${entry.count} changes merged`}
              />
            )}
          </Flex>
          <Text size="sm" color="text-low">
            {entry.count > 1
              ? datetime(entry.dateEnd)
              : datetime(entry.dateStart)}{" "}
            ·{" "}
            <EventUser
              user={auditUserInfoToEventUser(entry.user)}
              display="name"
            />
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
                {t`Expand ${entry.count} changes`}
              </Link>
            </Box>
          )}
        </Flex>
      </Box>
    );
  };

  const stepNumber = safeDiffPage + 1;
  const stepCount = steps.length;

  return (
    <Flex style={{ flex: 1, minHeight: 0, minWidth: 0, height: "100%" }}>
      {confirmRevertEntry && revert && (
        <ConfirmDialog
          title={revert.confirmTitle ?? revert.cta}
          content={
            revert.confirmBody ??
            t`This restores the selected version as a new change. Nothing is lost — you can revert again.`
          }
          yesText={t`Revert`}
          onConfirm={async () => {
            await revert.onRevert(confirmRevertEntry);
            setConfirmRevertEntry(null);
          }}
          onCancel={() => setConfirmRevertEntry(null)}
        />
      )}
      {/* Left column */}
      <Box
        style={{ width: 300, minWidth: 300, minHeight: 0 }}
        className={`${styles.sidebar} ${styles.sidebarLeft} overflow-auto`}
      >
        {/* Quick actions */}
        {!singleSelect && flatEntries.length >= 2 && (
          <Box className={`${styles.section} border-bottom`} pb="2">
            <Text size="md" weight="medium" color="text-mid" mb="2" as="p">
              <Trans>Quick actions</Trans>
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
                  <Text weight="semibold">
                    <Trans>Most recent change</Trans>
                  </Text>
                  <Text size="sm" color="text-low" as="div">
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
              {TIME_RANGE_ACTIONS.map(({ key, label, ms }) => {
                const cutoff = Date.now() - ms;
                const isActive = isWindowActive(cutoff);
                const isPending = pendingRange === key;
                // Disabled when the window is resolvable but contains no entries.
                const oldestLoaded =
                  flatEntries.length > 0
                    ? flatEntries[flatEntries.length - 1].dateEnd.getTime()
                    : Infinity;
                const windowResolved = !hasMore || oldestLoaded <= cutoff;
                const isEmpty =
                  windowResolved &&
                  getWindowSelection(flatEntries, cutoff) === null;
                return (
                  <Box
                    key={key}
                    className={`${styles.row} ${isActive ? styles.rowSelected : ""} ${isEmpty ? styles.rowDisabled : ""}`}
                    onClick={
                      isEmpty
                        ? undefined
                        : () => handleTimeRangeAction(key, cutoff)
                    }
                  >
                    <Box className={styles.rowSpacer} />
                    <Flex align="center" gap="2">
                      <Text weight="semibold">{i18n._(label)}</Text>
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
                    <Text weight="semibold">
                      <Trans>All changes</Trans>
                    </Text>
                    {loadingAll && !pendingRange && <LoadingSpinner />}
                  </Flex>
                  <Text size="sm" color="text-low">
                    <Trans>{total} total</Trans>
                  </Text>
                </Flex>
              </Box>
            </Flex>
          </Box>
        )}

        {/* Group by + entry list */}
        <Box className={styles.section} pb="3">
          <Flex align="center" justify="between" mb="2">
            <Text size="md" weight="medium" color="text-mid">
              {singleSelect ? (
                <Trans>Select a version</Trans>
              ) : (
                <Trans>Select a range of changes</Trans>
              )}
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
                        <Trans>Filters</Trans>
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
                          <Trans>Remove all filters</Trans>
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
                        {isAtDefault ? (
                          <Trans>Using default filters</Trans>
                        ) : (
                          <Trans>Use default filters</Trans>
                        )}
                      </Flex>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {sectionLabels.map((label) => {
                      const sectionName = sectionLabelText(label, config, i18n);
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
                            <Trans>Show {sectionName}</Trans>
                          </Flex>
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>
                      <Trans>Group items by</Trans>
                    </DropdownMenuLabel>
                    {(["minute", "hour", "day"] as const).map((opt) => (
                      <DropdownMenuItem
                        key={opt}
                        onClick={() => setGroupBy(opt)}
                      >
                        <Flex align="center" gap="1">
                          <span style={{ width: 24, display: "inline-flex" }}>
                            {groupBy === opt && <PiCheckBold size={14} />}
                          </span>
                          {i18n._(GROUP_BY_LABELS[opt])}
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
            <Text color="text-low">
              <Trans>No change history found.</Trans>
            </Text>
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
                        <Text size="sm" weight="medium" color="text-low">
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
                        <Text color="text-low" size="sm">
                          {resolveDisplayText(item.marker.label, i18n)}
                        </Text>
                      </Flex>,
                    );
                  } else {
                    // Noise item: hidden diffable changes + collapsed markers.
                    const lines: string[] = [];
                    const hiddenCount = item.hiddenCount;
                    if (hiddenCount > 0) {
                      lines.push(
                        hiddenCount === 1
                          ? t`${hiddenCount} change hidden`
                          : t`${hiddenCount} changes hidden`,
                      );
                    }
                    for (const m of item.markers) {
                      const markerLabel = resolveDisplayText(m.label, i18n);
                      lines.push(
                        m.count > 1
                          ? `${markerLabel} ×${m.count}`
                          : markerLabel,
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
                            <Text color="text-low" size="sm">
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
                        size="sm"
                        onClick={loadMore}
                        disabled={loading || loadingAll}
                      >
                        {loading && <LoadingSpinner />}
                        {t`Load ${loadMoreCount} more`}
                      </Button>
                      {remaining > PAGE_LIMIT && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleLoadAll}
                          disabled={loading || loadingAll}
                        >
                          {loadingAll && <LoadingSpinner />}
                          {t`Load all (${total})`}
                        </Button>
                      )}
                    </Flex>
                  );
                })()}
            </Flex>
          )}
        </Box>
      </Box>

      {/* Right column. minWidth 0 (here and on the root) keeps long code lines
          scrolling inside the column instead of widening the modal. */}
      <Box
        flexGrow="1"
        position="relative"
        className={`${styles.sidebar} overflow-auto`}
        style={{ minHeight: 0, minWidth: 0 }}
      >
        {steps.length === 0 && !isSingleEntry ? (
          <Text color="text-low">
            <Trans>
              Select at least one entry in the list to see the diff.
            </Trans>
          </Text>
        ) : (
          <Box pb="4">
            {/* Header row */}
            <Box
              pb="3"
              mb="3"
              style={{ borderBottom: "1px solid var(--gray-5)" }}
            >
              <Flex align="start" justify="between" gap="4" wrap="wrap">
                <Flex align="center" gap="4">
                  {diffViewMode === "steps" && (
                    <>
                      <Heading as="h2" size="sm" mb="0">
                        <Trans>
                          Step {stepNumber} of {stepCount}
                        </Trans>
                      </Heading>
                      <Flex gap="2">
                        <Button
                          variant="soft"
                          size="md"
                          disabled={safeDiffPage <= 0}
                          onClick={() => setDiffPage((p) => Math.max(0, p - 1))}
                        >
                          <Trans>Previous</Trans>
                        </Button>
                        <Button
                          variant="soft"
                          size="md"
                          disabled={safeDiffPage >= steps.length - 1}
                          onClick={() =>
                            setDiffPage((p) =>
                              Math.min(steps.length - 1, p + 1),
                            )
                          }
                        >
                          <Trans>Next</Trans>
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
                            <Tooltip body={t`Could not load entry`}>
                              <PiWarningBold
                                style={{
                                  color: "var(--red-9)",
                                  flexShrink: 0,
                                }}
                              />
                            </Tooltip>
                          )}
                          <Text weight="semibold" size="lg">
                            {getEntryLabel(singleEntryFirst)}
                          </Text>
                        </Flex>
                        <Box mt="2">
                          <AuditEntryAuthor user={singleEntryFirst.user} />
                        </Box>
                        <Text as="div">
                          {datetime(singleEntryFirst.dateStart)}
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
                {!isSingleEntry ? (
                  <Flex align="center" gap="2">
                    <Text size="md" weight="medium" color="text-mid">
                      <Trans>Show diff as</Trans>
                    </Text>
                    <Select
                      value={diffViewMode}
                      setValue={(v) => setDiffViewModeRaw(v)}
                      size="md"
                      mb="0"
                    >
                      <SelectItem value="steps">
                        <Trans>Steps</Trans>
                      </SelectItem>
                      <SelectItem value="single">
                        <Trans>Single diff</Trans>
                      </SelectItem>
                    </Select>
                  </Flex>
                ) : (
                  <Flex align="center" gap="3">
                    {singleSelect && singleEntryFirst && (
                      <Flex align="center" gap="2">
                        <Text size="md" weight="medium" color="text-mid">
                          <Trans>Compare against</Trans>
                        </Text>
                        <Select
                          value={comparisonBase}
                          setValue={(v) =>
                            setComparisonBase(v as typeof comparisonBase)
                          }
                          size="md"
                          mb="0"
                        >
                          <SelectItem value="current">
                            <Trans>Current version</Trans>
                          </SelectItem>
                          <SelectItem value="previous">
                            <Trans>Previous version</Trans>
                          </SelectItem>
                          <SelectItem
                            value="next"
                            disabled={
                              flatEntries[0]?.id === singleEntryFirst.id
                            }
                          >
                            <Trans>Next version</Trans>
                          </SelectItem>
                        </Select>
                      </Flex>
                    )}
                    {revert &&
                      singleEntryFirst &&
                      flatEntries[0]?.id !== singleEntryFirst.id && (
                        <Button
                          variant="outline"
                          color="red"
                          disabled={revert.disabled}
                          onClick={() =>
                            setConfirmRevertEntry(singleEntryFirst)
                          }
                        >
                          {revert.cta}
                        </Button>
                      )}
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
              <Callout status="error" mt="4">
                <Flex direction="column" gap="2" align="start">
                  <span>
                    <Plural
                      value={displayFailed.length}
                      one="Could not load change."
                      other="Could not load changes."
                    />
                  </span>
                  <span>
                    <Trans>
                      The audit record may be missing snapshot data.
                    </Trans>
                  </span>
                </Flex>
              </Callout>
            ) : activeDiffs.length === 0 ? (
              <Text color="text-low">
                <Trans>No changes between these entries.</Trans>
              </Text>
            ) : (
              <Box>
                <Heading as="h5" size="sm" color="text-mid" mt="4">
                  <Trans>Summary of changes</Trans>
                </Heading>

                {/* Badge strip — same layout as revision comparison modal */}
                {activeBadges.length > 0 && (
                  <Flex wrap="wrap" gap="2" mt="2">
                    {activeBadges.map((badge) => (
                      <Badge
                        key={badge.label}
                        color="gray"
                        variant="soft"
                        label={diffLabelText(badge, i18n)}
                        // action is passed through for future colour mapping
                        data-action={badge.action}
                      />
                    ))}
                  </Flex>
                )}

                {contentView ? (
                  <Box mt="3" mb="3">
                    <SplitButton
                      variant="outline"
                      className="diff-format-toggle"
                    >
                      <Button
                        size="md"
                        variant={showContent ? "solid" : "outline"}
                        onClick={() => setShowContent(true)}
                      >
                        {resolveDisplayText(contentView.label, i18n)}
                      </Button>
                      <Button
                        size="md"
                        variant={
                          !showContent && effectiveFormat === "formatted"
                            ? "solid"
                            : "outline"
                        }
                        onClick={() => {
                          setShowContent(false);
                          setFormat("formatted");
                        }}
                      >
                        <Trans>Formatted changes</Trans>
                      </Button>
                      <Button
                        size="md"
                        variant={
                          !showContent && effectiveFormat === "json"
                            ? "solid"
                            : "outline"
                        }
                        onClick={() => {
                          setShowContent(false);
                          setFormat("json");
                        }}
                      >
                        <Trans>JSON diffs</Trans>
                      </Button>
                    </SplitButton>
                  </Box>
                ) : (
                  <DiffFormatToggle
                    value={format}
                    setValue={setFormat}
                    mt="3"
                    mb="3"
                  />
                )}

                {/* Formatted mode shows human-readable renders when available;
                    otherwise it falls back to the JSON diffs. */}
                {contentView && showContent ? (
                  activeRawPost ? (
                    <Box my="3">
                      <Code
                        language={contentView.language}
                        code={contentView.get(activeRawPost as T)}
                      />
                    </Box>
                  ) : (
                    <Text color="text-low">
                      <Trans>No content for this version.</Trans>
                    </Text>
                  )
                ) : effectiveFormat === "formatted" &&
                  customRenderGroups.length > 0 ? (
                  <Flex direction="column" gap="0">
                    {customRenderGroups.map(
                      ({ label, renders, suppressCardLabel }) => (
                        <Box
                          key={label}
                          p="3"
                          my="3"
                          className="rounded bg-light"
                        >
                          {!suppressCardLabel && (
                            <Heading as="h6" size="sm" color="text-mid" mb="2">
                              {sectionLabelText(label, config, i18n)}
                            </Heading>
                          )}
                          {renders.map((r, i) => (
                            <Box key={i}>{r}</Box>
                          ))}
                        </Box>
                      ),
                    )}
                  </Flex>
                ) : effectiveFormat === "raw" ? (
                  // Non-sectional: a single diff of the entire before/after shape.
                  <Box my="3">
                    <ExpandableDiff
                      title={t`Raw JSON`}
                      a={stringifyForRawDiff(activeRawPre)}
                      b={stringifyForRawDiff(activeRawPost)}
                      defaultOpen
                      styles={COMPACT_DIFF_STYLES}
                    />
                  </Box>
                ) : (
                  <Flex
                    direction="column"
                    gap="4"
                    key={`${stepEntryA?.id ?? singleEntryFirst?.id}-${stepEntryB?.id ?? singleEntryLast?.id}`}
                  >
                    {activeDiffs.map((d, i) => (
                      <Box key={i}>
                        <ExpandableDiff
                          title={sectionLabelText(d.label, config, i18n)}
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
                )}
              </Box>
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
