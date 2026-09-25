import { useEffect, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretDown, PiCheck, PiPlus, PiStack, PiX } from "react-icons/pi";
import type { RowFilter } from "shared/types/fact-table";
import type { FeatureUsageLookback } from "shared/types/integrations";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import { Popover } from "@/ui/Popover";
import DateRangeTriggerPopover from "@/enterprise/components/ProductAnalytics/DateRangeTriggerPopover";
import type { FilterColumnSource } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerFilterRow";
import { operatorLabelMap } from "@/components/FactTables/rowFilterUtils";
import RowFilterBuilder, {
  isCompleteFilter,
} from "@/components/Filters/RowFilterBuilder";
// The dashboard's own control-pill styling, imported rather than copied so the
// two rows cannot drift apart: same surface fill, same hover.
import pillStyles from "@/enterprise/components/Dashboards/DashboardEditor/DashboardControlPill.module.scss";
import styles from "./FeatureDiagnosticsControlBar.module.scss";

/**
 * The rail speaks FeatureUsageLookback directly rather than going through
 * DateRangeComparePanel.
 *
 * That panel's value type is ExplorationDateRange, whose only sub-day unit is
 * `lookbackUnit: "hour"` — there is no minute unit, so "Last 15 minutes" cannot
 * be represented in it at all. Encoding it as some near-miss hour value would
 * put a wrong window into a type other surfaces resolve for real. The trigger
 * and popover shell are still the shared ones, so this matches the Event Logs
 * stream visually; only the rail's vocabulary differs.
 *
 * Driving `lookback` straight from here also means no conversion layer: the
 * value that lands in context is the value the chart's query string already
 * uses.
 *
 * DEBT: two preset rails now exist — this one and DateRangeComparePanel's. The
 * divergence is code-level only, since both sit in the same trigger and popover
 * shell, so users see one control. The alternative was adding a "minute" unit
 * to the shared `lookbackUnit` enum, which was rejected for the same reason the
 * Event Logs hour presets were: that enum is consumed by BlockDateRangePicker
 * and the back-end agent prompt, so widening it leaks new options into
 * dashboards. If `lookbackUnit` ever gains a minute unit for some other reason,
 * collapse these two rails into one.
 */
export const LOOKBACK_PRESETS: { id: FeatureUsageLookback; label: string }[] = [
  { id: "15minute", label: "Last 15 minutes" },
  { id: "hour", label: "Last hour" },
  { id: "day", label: "Last 24 hours" },
  { id: "week", label: "Last 7 days" },
];

/** Past this many, the rest collapse to "+N more". */
const MAX_VISIBLE_CHIPS = 4;

/**
 * "source = experiment, rollout" — the values, never "Source (2)". A chip that
 * only counts forces a click to answer the question it raised.
 *
 * The operator comes from the same map the operator select renders from, so the
 * chip reads back exactly what is selected inside it rather than a second
 * vocabulary for the same thing.
 */
function chipLabel(
  filter: RowFilter,
  columns: FilterColumnSource["columns"],
): string {
  // The column's display label, so a chip names the field the way the menu
  // and the group-by control do ("Rule", not "ruleId").
  const field =
    columns.find((c) => c.value === filter.column)?.label ??
    filter.column ??
    "Filter";
  const operator = operatorLabelMap[filter.operator] ?? filter.operator;
  const values = (filter.values ?? []).filter((v) => v !== "");
  if (!values.length) return `${field} ${operator}`;
  return `${field} ${operator} ${values.join(", ")}`;
}

const formatter = Intl.NumberFormat("en-US");

/** One environment the picker offers, with the two facts its marker needs. */
export interface EnvironmentOption {
  id: string;
  /** `feature.environmentSettings[id].enabled`. */
  enabled: boolean;
  /** Evaluations in the selected window. */
  evaluations: number;
}

/**
 * Scope, not a filter — which is why it has a value and no remove button. A
 * filter chip is added and can be taken away; a scope chip always has a value,
 * so there is nothing for an X to return it to.
 *
 * Selection is staged in the popover and committed on Apply, the same deferred
 * cost guard the time frame uses: each commit is a warehouse read, so ticking
 * three boxes should cost one query rather than three.
 */
function EnvironmentScopeChip({
  environmentOptions,
  selected,
  onChange,
  portalContainer,
}: {
  environmentOptions: EnvironmentOption[];
  selected: string[];
  onChange: (environments: string[]) => void;
  portalContainer: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);

  /**
   * Named in the environment list's own order, not click order — a label that
   * reshuffled as you ticked boxes would read as a different selection each
   * time.
   */
  const selectedInOrder = environmentOptions
    .map((e) => e.id)
    .filter((id) => selected.includes(id));

  // The values themselves, truncated past two. Naming the first two and
  // counting the rest keeps the pill a predictable width while still saying
  // what is in scope; "All environments" said neither.
  const label = !selectedInOrder.length
    ? "No environments"
    : selectedInOrder.length <= 2
      ? selectedInOrder.join(", ")
      : `${selectedInOrder.slice(0, 2).join(", ")}, +${
          selectedInOrder.length - 2
        }`;

  /**
   * Commits on click rather than behind an Apply, matching the time frame
   * beside it: one commit is one scan, and the preset rail already accepts that
   * cost. The filter builder keeps its Apply, because a half-built condition is
   * not something to commit at all.
   */
  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((e) => e !== id)
      : [...selected, id];
    // Never an empty scope — it would return nothing and read as a broken chart
    // rather than as a choice, so the last remaining environment does not
    // untick.
    if (!next.length) return;
    onChange(next);
  };

  return (
    <Popover
      open={open}
      // Nothing to reseed: selection commits as it is made, so there is no
      // draft that could be left behind.
      onOpenChange={setOpen}
      align="start"
      portalContainer={portalContainer}
      // The time frame menu's chrome, copied rather than approximated. Two
      // things were making this look different despite an identical rail:
      // ui/Popover defaults to showArrow, and it applies `padding: 15px 20px`
      // unless a caller overrides it — so the rail was sitting inside an extra
      // inset that DateRangeTriggerPopover does not have.
      showArrow={false}
      contentStyle={{
        padding: 0,
        width: 200,
        maxHeight: "var(--radix-popover-content-available-height)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 1050,
      }}
      trigger={
        // Same trigger as the time frame chip: leading icon, label, trailing
        // caret, and the same surface fill it sets inline over the pill class.
        // Only the icon and the value differ, because only those two things do.
        <Button
          variant="outline"
          color="gray"
          size="md"
          className={`${pillStyles.controlPill} ${styles.scopeTrigger}`}
          icon={<PiStack aria-hidden />}
          iconPosition="left"
          title={selectedInOrder.join(", ")}
          style={{
            justifyContent: "space-between",
            backgroundColor: "var(--color-surface)",
            maxWidth: 260,
          }}
        >
          <Flex align="center" gap="2" justify="between" width="100%">
            <span
              style={{
                // Absorbs the slack so the label hugs the icon; without it
                // justify="between" pushes it toward the middle.
                flexGrow: 1,
                minWidth: 0,
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
            <PiCaretDown aria-hidden style={{ flexShrink: 0 }} />
          </Flex>
        </Button>
      }
      content={
        // The same rail the time frame menu uses, so the two read as one
        // control family. Multi-select is the only difference: a row toggles
        // and shows a check instead of replacing the selection.
        <Box
          className={styles.presetList}
          role="group"
          aria-label="Environments"
        >
          {environmentOptions.map((env) => {
            const active = selected.includes(env.id);
            return (
              <button
                key={env.id}
                type="button"
                aria-pressed={active}
                className={`${styles.preset} ${active ? styles.presetActive : ""}`}
                onClick={() => toggle(env.id)}
              >
                <Flex align="center" justify="between" gap="3">
                  <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                    <span>{env.id}</span>
                    {/* Enabled but silent is a property of the WINDOW, not of
                        the environment — at Last 15 minutes on a quiet flag it
                        is unremarkable, so the wording says which. */}
                    {env.enabled && env.evaluations === 0 && (
                      <Text size="sm" color="text-low">
                        none in this window
                      </Text>
                    )}
                    {/* Disabled but receiving traffic is the anomaly worth
                        seeing: an SDK evaluating where the flag is off. The
                        count travels with it, because "not enabled" alone reads
                        as the benign case. */}
                    {!env.enabled && env.evaluations > 0 && (
                      <span style={{ color: "var(--amber-11)" }}>
                        <Text size="sm">
                          {`not enabled · ${formatter.format(env.evaluations)}`}
                        </Text>
                      </span>
                    )}
                  </Flex>
                  {/* Reserved whether or not it is shown, so rows do not shift
                      as the selection changes. */}
                  <span style={{ flexShrink: 0, width: 14 }}>
                    {active && <PiCheck size={14} aria-hidden />}
                  </span>
                </Flex>
              </button>
            );
          })}
        </Box>
      }
    />
  );
}

/**
 * One applied condition, as a neutral pill that can be edited or removed.
 *
 * The pill is the popover trigger and the ✕ is a sibling positioned over the
 * padding the pill reserves for it — nesting an interactive control inside
 * another breaks keyboard and screen-reader behaviour. Same composition as the
 * dashboard's removable pills, whose stylesheet this shares.
 */
function FilterChip({
  label,
  filter,
  columnSource,
  portalContainer,
  onChange,
  onRemove,
}: {
  label: string;
  filter: RowFilter;
  columnSource: FilterColumnSource;
  portalContainer: HTMLElement | null;
  onChange: (next: RowFilter) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RowFilter[]>([filter]);

  return (
    <span className={pillStyles.pillWrap}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Reseed from the applied condition on open, so an abandoned edit
          // never survives into the next one.
          if (next) setDraft([filter]);
          setOpen(next);
        }}
        align="start"
        portalContainer={portalContainer}
        contentStyle={{ width: 360, zIndex: 1050 }}
        trigger={
          <Button
            variant="outline"
            color="gray"
            size="md"
            className={`${pillStyles.controlPill} ${pillStyles.controlPillRemovable} ${styles.chipRemovable}`}
          >
            {label}
          </Button>
        }
        content={
          <RowFilterBuilder
            variant="condition"
            value={draft}
            setValue={setDraft}
            // The condition as applied, so Apply stays disabled until the user
            // actually changes something.
            applied={[filter]}
            columnSource={columnSource}
            onApply={() => {
              const [next] = draft.filter(isCompleteFilter);
              if (next) onChange(next);
              setOpen(false);
            }}
          />
        }
      />
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        className={pillStyles.pillRemove}
        aria-label={`Remove ${label} filter`}
        title={`Remove ${label} filter`}
        onClick={onRemove}
        // Geometry inline: an IconButton is 24px square with its own margins,
        // which reads oversized inside a 32px pill, and Radix's size rules
        // match a class override too closely to reliably win.
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          width: 18,
          height: 18,
          minWidth: 0,
          margin: 0,
        }}
      >
        <PiX size={11} aria-hidden />
      </IconButton>
    </span>
  );
}

interface Props {
  lookback: FeatureUsageLookback;
  onLookbackChange: (lookback: FeatureUsageLookback) => void;

  /** Environments relevant to this flag — see EnvironmentOption. */
  environmentOptions: EnvironmentOption[];
  /** The scope in effect. Always non-empty — see EnvironmentScopeChip. */
  selectedEnvironments: string[];
  onSelectedEnvironmentsChange: (environments: string[]) => void;

  filters: RowFilter[];
  onFiltersChange: (filters: RowFilter[]) => void;
  columnSource: FilterColumnSource;
}

export default function FeatureDiagnosticsControlBar({
  lookback,
  onLookbackChange,
  environmentOptions,
  selectedEnvironments,
  onSelectedEnvironmentsChange,
  filters,
  onFiltersChange,
  columnSource,
}: Props) {
  const [rangeOpen, setRangeOpen] = useState(false);
  // The Radix theme root, used as the Add filter popover's portal target. It is
  // a stacking context (`position: relative; z-index: 0`), and the select menus
  // inside the popover portal into it to escape the popover's own transform —
  // so the popover has to live in that same context for their z-indexes to be
  // comparable. Resolved in an effect because document does not exist on the
  // server.
  const [themeRoot, setThemeRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setThemeRoot(document.querySelector(".radix-themes"));
  }, []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Staged separately from `filters`: every commit is a warehouse read, so a
  // two-clause filter should cost one query rather than three.
  const [draftFilters, setDraftFilters] = useState<RowFilter[]>(filters);

  const selectedLabel =
    LOOKBACK_PRESETS.find((p) => p.id === lookback)?.label ?? "Last 24 hours";

  // Only complete rows become chips — a half-filled row describes nothing and
  // is not filtering the data either.
  /**
   * Columns already spoken for. A second filter on the same column would be an
   * AND of two equalities on one field, which matches nothing — so the option
   * is hidden rather than offered and then quietly producing an empty table.
   */
  const usedColumns = useMemo(
    () => new Set(filters.map((f) => f.column).filter((c): c is string => !!c)),
    [filters],
  );

  /**
   * The column list minus what is already used. `allow` keeps one column in the
   * list — the one the chip being edited already uses, which would otherwise
   * disappear from its own select and read as unset.
   */
  const narrowColumnSource = (allow?: string): FilterColumnSource => ({
    ...columnSource,
    columns: columnSource.columns.filter(
      (c) => c.value === allow || !usedColumns.has(c.value),
    ),
  });

  // Index travels with each chip: edits and removals address a position in the
  // applied array, and incomplete rows are filtered out of the display.
  const chips = filters
    .map((filter, index) => ({ filter, index }))
    .filter(({ filter }) => filter.column && (filter.values ?? []).length);
  const visibleChips = chips.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = chips.length - visibleChips.length;

  // Commits the staged condition. Apply is the only caller: closing the popover
  // any other way discards, so an abandoned half-built condition never lands.
  const commitDraft = () => {
    const ready = draftFilters.filter(isCompleteFilter);
    // Incomplete rows are dropped rather than committed: the request builder
    // ignores them anyway, and a chip for a half-filled condition says nothing.
    if (ready.length) onFiltersChange([...filters, ...ready]);
  };

  const openFilters = (open: boolean) => {
    // One blank condition, not the applied set. The control says "Add filter",
    // and what is already applied is visible as chips beside it — seeding from
    // `filters` meant an empty popover on first use, since there was nothing
    // applied yet to seed from.
    if (open) setDraftFilters([{ operator: "=", values: [] }]);
    setFiltersOpen(open);
  };

  return (
    // Filters only. Freshness and Refresh moved to the table's own header,
    // where they sit inline with the title they describe — on this row they
    // read as if they applied to the filters.
    <Flex align="center" gap="2" wrap="wrap" className={styles.bar}>
      {/* Commits on selection, deliberately: a control that resolves to one
            choice has nothing to batch, and closing the popover is the commit
            gesture. The filter builder beside it batches because it does. */}
      <DateRangeTriggerPopover
        open={rangeOpen}
        onOpenChange={setRangeOpen}
        label={selectedLabel}
        align="start"
        contentWidth={200}
        triggerClassName={pillStyles.controlPill}
      >
        <Box
          className={styles.presetList}
          role="group"
          aria-label="Time frame presets"
        >
          {LOOKBACK_PRESETS.map((preset) => {
            const active = preset.id === lookback;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                className={`${styles.preset} ${active ? styles.presetActive : ""}`}
                onClick={() => {
                  onLookbackChange(preset.id);
                  setRangeOpen(false);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </Box>
      </DateRangeTriggerPopover>

      {/* Beside the time frame, because both are scope: they always have a
          value and neither can be removed. The filter chips that follow are the
          opposite — added, and each with its own X. */}
      <EnvironmentScopeChip
        environmentOptions={environmentOptions}
        selected={selectedEnvironments}
        onChange={onSelectedEnvironmentsChange}
        portalContainer={themeRoot}
      />

      {visibleChips.map((chip) => (
        <FilterChip
          key={chip.index}
          label={chipLabel(chip.filter, columnSource.columns)}
          filter={chip.filter}
          columnSource={narrowColumnSource(chip.filter.column)}
          portalContainer={themeRoot}
          onChange={(next) =>
            onFiltersChange(
              filters.map((f, idx) => (idx === chip.index ? next : f)),
            )
          }
          onRemove={() =>
            onFiltersChange(filters.filter((_, idx) => idx !== chip.index))
          }
        />
      ))}
      {overflowCount > 0 && (
        <Badge
          label={`+${overflowCount} more`}
          color="gray"
          variant="soft"
          radius="full"
          title={chips
            .slice(MAX_VISIBLE_CHIPS)
            .map((c) => chipLabel(c.filter, columnSource.columns))
            .join("\n")}
        />
      )}

      <Popover
        open={filtersOpen}
        onOpenChange={openFilters}
        align="start"
        portalContainer={themeRoot}
        // Inside the theme root the popover competes with page chrome, so it
        // needs a z-index of its own: above the top bar at 1010, below the
        // select menus at 1100 that open out of it.
        contentStyle={{ width: 360, zIndex: 1050 }}
        trigger={
          <Button
            variant="outline"
            size="md"
            className={pillStyles.controlPill}
            icon={<PiPlus aria-hidden />}
            iconPosition="left"
          >
            Add Filter
          </Button>
        }
        content={
          <RowFilterBuilder
            variant="condition"
            value={draftFilters}
            setValue={setDraftFilters}
            // Empty baseline: the draft is a new condition, so Apply compares
            // against "no condition yet" rather than against the applied set it
            // is about to be added to.
            applied={[]}
            columnSource={narrowColumnSource()}
            onApply={() => {
              commitDraft();
              setFiltersOpen(false);
            }}
          />
        }
      />

      {/* Only once something is applied — a Clear with nothing to clear is a
          control that never does anything. Reads the applied set, not the
          draft, so it describes what the table is actually filtered by.

          Pushed to the right edge with margin-left rather than a
          justify="between" on the row, so the controls on the left keep
          wrapping as one group instead of splitting across the gap. */}
      {filters.length > 0 && (
        <Box className={styles.clearAll}>
          {/* A link, not a button: this is the quietest action on the row and
              should not read as a third control beside the pills. @/ui/Link
              renders a real <button> when given onClick without href, so the
              semantics stay right. size="sm" is the same Radix step the ghost
              button used, so the type size is unchanged. */}
          <Link size="sm" onClick={() => onFiltersChange([])}>
            Clear All
          </Link>
        </Box>
      )}
    </Flex>
  );
}
