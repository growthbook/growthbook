import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretLeft, PiCaretRight, PiFunnelSimple } from "react-icons/pi";
import type { RowFilter } from "shared/types/fact-table";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import type { FilterColumnSource } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerFilterRow";
import RowFilterBuilder, {
  hasApplyableFilterChange,
} from "@/components/Filters/RowFilterBuilder";
import DateRangeTriggerPopover from "@/enterprise/components/ProductAnalytics/DateRangeTriggerPopover";
import EventLogTimeFramePanel, {
  formatTimeFrameLabel,
  isCompleteTimeFrame,
  type EventLogTimeFrame,
} from "./EventLogTimeFramePanel";
import styles from "./EventLogStreamFilterPanel.module.scss";

interface Props {
  timeFrame: EventLogTimeFrame;
  onTimeFrameChange: (frame: EventLogTimeFrame) => void;

  filters: RowFilter[];
  onFiltersChange: (filters: RowFilter[]) => void;
  columnSource: FilterColumnSource;
}

export default function EventLogStreamFilterPanel({
  timeFrame,
  onTimeFrameChange,
  filters,
  onFiltersChange,
  columnSource,
}: Props) {
  // Expanded by default: the panel holds the time frame, which is page state
  // and cannot be hidden behind a collapsed rail.
  const [collapsed, setCollapsed] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);

  // Both controls are staged here and only handed up on Apply: each committed
  // change is a warehouse query, and building a two-clause filter over a custom
  // range should cost one request rather than four.
  const [draftFilters, setDraftFilters] = useState<RowFilter[]>(filters);
  const [draftTimeFrame, setDraftTimeFrame] =
    useState<EventLogTimeFrame>(timeFrame);
  // Resync when the applied filters change from outside (a host resetting them,
  // or a remount), so the draft cannot drift from what the table is showing.
  useEffect(() => {
    setDraftFilters(filters);
  }, [filters]);

  useEffect(() => {
    setDraftTimeFrame(timeFrame);
  }, [timeFrame]);

  const timeFrameDirty =
    JSON.stringify(draftTimeFrame) !== JSON.stringify(timeFrame);

  const filtersApplyable = hasApplyableFilterChange(draftFilters, filters);
  // A custom range with only one bound filled in cannot be resolved, so it must
  // not reach the request.
  const timeFrameApplyable =
    timeFrameDirty && isCompleteTimeFrame(draftTimeFrame);
  const applyDisabled = !filtersApplyable && !timeFrameApplyable;

  // Counts applied filters, not staged ones: the rail describes what the table
  // is showing.
  const activeFilterCount = filters.length;

  if (collapsed) {
    return (
      <Box className={`${styles.panel} ${styles.panelCollapsed}`}>
        <Tooltip content="Show filters">
          <button
            type="button"
            className={styles.toggle}
            aria-label="Show filters"
            onClick={() => setCollapsed(false)}
          >
            <PiCaretRight size={10} aria-hidden />
          </button>
        </Tooltip>
        <Flex className={styles.collapsedRail}>
          {/* Lighter than the body text: collapsed, this is a marker for what
              the rail is, not a value to read. */}
          <PiFunnelSimple size={16} color="var(--gray-9)" aria-hidden />
          {activeFilterCount > 0 ? (
            <Badge
              label={String(activeFilterCount)}
              size="xs"
              variant="soft"
              color="violet"
              radius="full"
            />
          ) : null}
        </Flex>
      </Box>
    );
  }

  return (
    <Box className={styles.panel}>
      <Tooltip content="Hide filters">
        <button
          type="button"
          className={styles.toggle}
          aria-label="Hide filters"
          onClick={() => setCollapsed(true)}
        >
          <PiCaretLeft size={10} aria-hidden />
        </button>
      </Tooltip>

      <Box className={styles.body}>
        {/* Wrapped: @/ui/Text takes no className. */}
        <Box className={styles.sectionLabel}>
          <Text size="md" weight="semibold">
            Timeframe
          </Text>
        </Box>

        {/* The dashboard's trigger + popover shell, reused rather than
            restyled. Only the contents differ: our own preset rail and custom
            range fields, no comparison mode and no granularity. The trigger
            summarises the draft, so a custom range reads back as dates rather
            than as the word "Custom". */}
        <DateRangeTriggerPopover
          open={rangeOpen}
          onOpenChange={setRangeOpen}
          label={formatTimeFrameLabel(draftTimeFrame)}
          tooltip={formatTimeFrameLabel(draftTimeFrame)}
          fullWidth
          align="start"
          contentWidth={300}
        >
          <EventLogTimeFramePanel
            value={draftTimeFrame}
            onChange={setDraftTimeFrame}
          />
        </DateRangeTriggerPopover>

        {/* Starts empty: no pre-applied filters and no default dimension
            dropdowns. The add menu lists the known dimensions first. */}
        {/* showFooter is off: this rail's footer commits the time frame in the
            same gesture, so it cannot use one that only knows about filters. */}
        <Box mt="5">
          <RowFilterBuilder
            value={draftFilters}
            setValue={setDraftFilters}
            applied={filters}
            columnSource={columnSource}
            showFooter={false}
          />
        </Box>
      </Box>

      {/* Same footer shape as DateRangeComparePanel: actions right-aligned,
          secondary outline and primary solid at default size. Padding follows
          the panel's own insets rather than its p="3" so the buttons stay flush
          with the content above them. The separating rule is a border on the
          footer rather than a Separator above it, so it travels with the
          sticky row instead of scrolling away from it.

          Hidden while there is nothing to act on. The time frame is part of
          that test now: a range change with no filters still needs an Apply to
          commit it. */}
      {(draftFilters.length > 0 || filters.length > 0 || timeFrameDirty) && (
        <Flex
          justify="end"
          gap="2"
          py="3"
          pr="5"
          style={{ flexShrink: 0 }}
          className={styles.footer}
        >
          <Button
            variant="outline"
            // Clears filters only. The time frame always has a value — there is
            // no cleared state for it to go to.
            disabled={draftFilters.length === 0 && filters.length === 0}
            onClick={() => {
              // Clears and commits: a Clear that left the table filtered would
              // not be a clear.
              setDraftFilters([]);
              onFiltersChange([]);
            }}
          >
            Clear
          </Button>
          <Button
            disabled={applyDisabled}
            onClick={() => {
              if (timeFrameApplyable) onTimeFrameChange(draftTimeFrame);
              if (filtersApplyable) onFiltersChange(draftFilters);
            }}
          >
            Apply
          </Button>
        </Flex>
      )}
    </Box>
  );
}
