import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import type { RowFilter } from "shared/types/fact-table";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { ExplorerRowFilterInput } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerRowFilterInput";
import type { FilterColumnSource } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerFilterRow";

/**
 * Operators that carry their meaning entirely in the operator, so a row using
 * one is complete without a value. None are reachable from the "simple"
 * variant, which offers equality only — they are here so the rule still holds
 * if that variant ever widens.
 */
const VALUELESS_OPERATORS: RowFilter["operator"][] = [
  "is_true",
  "is_false",
  "is_null",
  "not_null",
];

/**
 * A row is only worth committing once it names a column and carries a value.
 * Add Filter seeds a blank row, so without this Apply would light up on a row
 * that filters nothing.
 *
 * Mirrors ExplorerFilterRow's own two requirements rather than inventing a
 * second definition of "filled in": `sql_expr` and `saved_filter` put their
 * expression in `values` and need no column, and the four operators above need
 * no value.
 */
export function isCompleteFilter(filter: RowFilter): boolean {
  const columnRequired =
    filter.operator !== "sql_expr" && filter.operator !== "saved_filter";
  if (columnRequired && !filter.column) return false;
  if (VALUELESS_OPERATORS.includes(filter.operator)) return true;
  return (filter.values ?? []).some((v) => v !== "");
}

/**
 * Whether a draft is worth spending a query on. Adding a blank row is a change
 * but not an applyable one; emptying the draft is applyable because Apply is
 * also how a removal down to zero gets committed.
 */
export function hasApplyableFilterChange(
  draft: RowFilter[],
  applied: RowFilter[],
): boolean {
  if (JSON.stringify(draft) === JSON.stringify(applied)) return false;
  return draft.length === 0 || draft.some(isCompleteFilter);
}

interface Props {
  /** Staged filters. The host owns this so it can batch other controls with it. */
  value: RowFilter[];
  setValue: (filters: RowFilter[]) => void;
  /** What the surface is currently filtered by — the dirty check compares to it. */
  applied: RowFilter[];
  columnSource: FilterColumnSource;

  /**
   * Off for hosts that fold Clear and Apply into a footer of their own — the
   * Event Logs rail commits its time frame in the same row, so it cannot use a
   * footer that only knows about filters.
   */
  showFooter?: boolean;
  footerClassName?: string;
  onApply?: () => void;
  onClear?: () => void;

  /**
   * "panel" is the full rail: a counted heading, an Add Filter button and the
   * whole staged set, for a surface with room to show everything at once.
   *
   * "condition" is a single condition and nothing else — no heading, no add
   * button, no Clear. For a popover opened from an "Add filter" control, where
   * the surrounding chrome repeats what the control already said and the
   * committed filters are already visible as chips behind it.
   */
  variant?: "panel" | "condition";
}

/**
 * The stacked filter cards plus their Add / Clear / Apply affordances, shared
 * by the Event Logs stream rail and the feature Diagnostics control bar so the
 * two are the same control rather than two that resemble each other.
 *
 * Deliberately not the whole rail: the Event Logs panel keeps its own time
 * frame section, collapse toggle and sticky footer, because none of those mean
 * anything in a popover.
 */
export default function RowFilterBuilder({
  value,
  setValue,
  applied,
  columnSource,
  showFooter = true,
  footerClassName,
  onApply,
  onClear,
  variant = "panel",
}: Props) {
  // Remount key for the input below. It holds its own row state and its sync
  // effect only handles additions (`if (value.length > validFilters.length)`),
  // so handing it a shorter list — a Clear, or a host reset — leaves the
  // removed rows on screen. Remounting rebuilds them from the value it was
  // given. Keyed off a shrink rather than off the applied set, so it is correct
  // for a host that never re-applies.
  const [builderKey, setBuilderKey] = useState(0);
  const previousLength = useRef(value.length);
  useEffect(() => {
    if (value.length < previousLength.current) setBuilderKey((k) => k + 1);
    previousLength.current = value.length;
  }, [value.length]);

  const applyDisabled = !hasApplyableFilterChange(value, applied);

  return (
    <Box>
      {/* The header sits here rather than inside the input: the section has to
          show its count and the add control even with no rows, and the shared
          input only renders its own heading in the "full" variant. */}
      {variant === "panel" && (
        <Flex align="center" justify="between" gap="2" mb="2">
          <Text size="md" weight="semibold">
            {/* Counts the rows below it, so this follows the draft rather than
              what is applied. */}
            {value.length > 0 ? `Filters (${value.length})` : "Filters"}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            icon={<PiPlus aria-hidden />}
            iconPosition="left"
            onClick={() =>
              // A blank row: the field select is the first thing to fill in.
              // Equality is the only operator this variant offers, so it is the
              // right default rather than a guess.
              setValue([...value, { operator: "=", values: [] }])
            }
          >
            Add Filter
          </Button>
        </Flex>
      )}

      <ExplorerRowFilterInput
        key={builderKey}
        value={value}
        setValue={setValue}
        columnSource={columnSource}
        variant={variant === "condition" ? "condition" : "simple"}
      />

      {/* The condition variant gets Apply and nothing else: there is one
          condition, so there is nothing to Clear that closing the popover would
          not also discard. Apply stays because it is still the only thing that
          spends a query. */}
      {showFooter && (value.length > 0 || applied.length > 0) && (
        <Flex
          justify="end"
          gap="2"
          pt="3"
          mt="3"
          pb="0"
          style={{
            flexShrink: 0,
            // A rule above the actions, so Apply reads as a footer rather than
            // as one more control in the condition it commits.
            borderTop: "1px solid var(--slate-a5)",
          }}
          className={footerClassName}
        >
          {variant === "panel" && (
            <Button
              variant="outline"
              disabled={value.length === 0 && applied.length === 0}
              onClick={() => {
                // Clears and commits: a Clear that left the surface filtered
                // would not be a clear.
                setValue([]);
                onClear?.();
              }}
            >
              Clear
            </Button>
          )}
          <Button disabled={applyDisabled} onClick={() => onApply?.()}>
            Apply
          </Button>
        </Flex>
      )}
    </Box>
  );
}
