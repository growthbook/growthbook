import { Box, Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import { PiX } from "react-icons/pi";
import { useCallback, useEffect, useRef, useState } from "react";
import { isEqual } from "lodash";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { RowFilterActions } from "./RowFilterActions";
import { RowFilterFields } from "./RowFilterFields";
import { isRowFilterComplete, type FilterColumnSource } from "./rowFilterUtils";

/** A local id keeps a row from remounting (and losing focus) as it is edited. */
type LocalRowFilter = RowFilter & { _localId: number };

function toRowFilter({ _localId: _id, ...rest }: LocalRowFilter): RowFilter {
  return rest;
}

/**
 * A sidebar of (column, operator, value) filter rows with a staged Apply.
 *
 * Unlike the explorer's `ExplorerRowFilterInput`, edits do not commit as you
 * type — `setValue` fires only on Apply or Clear. That suits a surface where
 * applying is the expensive or visible step, and it lets Apply report whether
 * there is anything to apply.
 */
export function RowFilterPanel({
  value,
  setValue,
  columnSource,
  showSqlFilter = false,
  disabled,
}: {
  /** The committed filters. */
  value: RowFilter[];
  /** Called on Apply and Clear, never while editing a row. */
  setValue: (value: RowFilter[]) => void;
  columnSource: FilterColumnSource;
  showSqlFilter?: boolean;
  disabled?: boolean;
}) {
  const nextIdRef = useRef(0);
  const assignId = useCallback(() => nextIdRef.current++, []);

  const [local, setLocal] = useState<LocalRowFilter[]>(() =>
    value.map((f) => ({ ...f, _localId: assignId() })),
  );

  // What we last pushed out. Applying drops incomplete rows, so the committed
  // value legitimately differs from what is on screen — without this, Apply
  // would bounce back and delete the row someone is still filling in.
  const lastCommittedRef = useRef<RowFilter[]>(value);

  // Resync only when the value changes from outside (a reset, or another
  // control clearing filters), never in response to our own commit.
  useEffect(() => {
    if (isEqual(value, lastCommittedRef.current)) return;
    lastCommittedRef.current = value;
    setLocal(value.map((f) => ({ ...f, _localId: assignId() })));
  }, [value, assignId]);

  const commit = useCallback(
    (filters: RowFilter[]) => {
      lastCommittedRef.current = filters;
      setValue(filters);
    },
    [setValue],
  );

  // Only complete filters are worth applying; a half-built row is ignored
  // rather than treated as "match nothing".
  const applicable = local.map(toRowFilter).filter(isRowFilterComplete);
  const hasPendingChanges = !isEqual(applicable, value);

  const update = (index: number, updates: Partial<RowFilter>) =>
    setLocal((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f)),
    );

  return (
    <Flex direction="column" gap="3" height="100%">
      <Flex justify="between" align="center" gap="2">
        <Text weight="medium">
          Filters{local.length > 0 ? ` (${local.length})` : ""}
        </Text>
        <RowFilterActions
          showSqlFilter={showSqlFilter}
          disabled={disabled}
          onAdd={(filter) =>
            setLocal((prev) => [...prev, { ...filter, _localId: assignId() }])
          }
        />
      </Flex>

      <Flex direction="column" gap="2">
        {local.map((filter, i) => (
          <RowFilterCard
            key={filter._localId}
            filter={filter}
            index={i}
            columnSource={columnSource}
            autoFocus={i === local.length - 1}
            onUpdate={(updates) => update(i, updates)}
            onDelete={() =>
              setLocal((prev) => prev.filter((_, idx) => idx !== i))
            }
          />
        ))}
      </Flex>

      <Box flexGrow="1" />

      <Flex
        justify="end"
        gap="2"
        pt="3"
        style={{ borderTop: "1px solid var(--gray-a3)" }}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || (!local.length && !value.length)}
          onClick={() => {
            setLocal([]);
            commit([]);
          }}
        >
          Clear
        </Button>
        <Button
          size="sm"
          disabled={disabled || !hasPendingChanges}
          onClick={() => commit(applicable)}
        >
          Apply
        </Button>
      </Flex>
    </Flex>
  );
}

function RowFilterCard({
  filter,
  index,
  columnSource,
  autoFocus,
  onUpdate,
  onDelete,
}: {
  filter: RowFilter;
  index: number;
  columnSource: FilterColumnSource;
  autoFocus?: boolean;
  onUpdate: (updates: Partial<RowFilter>) => void;
  onDelete: () => void;
}) {
  const summary = getFilterSummary(filter, index, columnSource);

  return (
    <Flex
      direction="column"
      gap="2"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-3)",
        padding: "var(--space-2)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex justify="between" align="center" gap="2">
        <Text size="sm" truncate whiteSpace="nowrap" title={summary}>
          {summary}
        </Text>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label={`Remove ${summary}`}
        >
          <PiX size={14} aria-hidden />
        </Button>
      </Flex>
      <RowFilterFields
        filter={filter}
        columnSource={columnSource}
        autoFocus={autoFocus}
        onUpdate={(updates) => onUpdate(updates)}
      >
        {({ columnSelect, operatorSelect, valueInput }) => (
          <Flex direction="column" gap="2">
            {columnSelect && operatorSelect ? (
              <Flex direction="row" gap="2" align="center">
                <Box flexGrow="1" style={{ minWidth: 0, flexBasis: 0 }}>
                  {columnSelect}
                </Box>
                <Box style={{ minWidth: 0, flex: "0 1 110px" }}>
                  {operatorSelect}
                </Box>
              </Flex>
            ) : (
              columnSelect
            )}
            {valueInput}
          </Flex>
        )}
      </RowFilterFields>
    </Flex>
  );
}

/** "Browser = Chrome" once the row says something, "Filter 1" until then. */
function getFilterSummary(
  filter: RowFilter,
  index: number,
  columnSource: FilterColumnSource,
): string {
  if (!filter.column) return `Filter ${index + 1}`;
  const column =
    columnSource.columns.find((c) => c.value === filter.column)?.label ??
    filter.column;
  return `${column} ${filter.operator} ${filter.values?.join(", ") ?? ""}`.trim();
}
