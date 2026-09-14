import { Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import { useState, useEffect, useCallback, useRef } from "react";
import { isEqual } from "lodash";
import Text from "@/ui/Text";
import { type FilterColumnSource } from "@/components/FactTables/rowFilterUtils";
import { ExplorerFilterRow, type ExplorerRowFilter } from "./ExplorerFilterRow";

/** Strip front-end-only fields for setValue (commit). */
function toRowFilter(f: ExplorerRowFilter): RowFilter {
  const { disabled: _d, collapsed: _c, _localId: _id, ...rest } = f;
  return rest;
}

export function ExplorerRowFilterInput({
  value,
  setValue,
  columnSource,
}: {
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  columnSource: FilterColumnSource;
}) {
  const nextIdRef = useRef(0);
  const assignId = () => nextIdRef.current++;

  const [localFilters, setLocalFilters] = useState<ExplorerRowFilter[]>(() =>
    value.map((f) => ({
      ...f,
      _localId: assignId(),
      disabled: false,
      collapsed: false,
    })),
  );

  // What this component last pushed up. Anything else arriving in `value` came
  // from outside (a parent appending a row, the sample rows modal saving) and
  // has to be adopted into local state.
  const lastCommittedRef = useRef<RowFilter[]>(value);

  useEffect(() => {
    if (isEqual(value, lastCommittedRef.current)) return;
    lastCommittedRef.current = value;

    // Walk the enabled rows in order and re-point each at its counterpart in
    // `value`, keeping `_localId` and `collapsed` so an external edit doesn't
    // remount or re-expand the rows around it. Disabled rows aren't in `value`
    // at all, so they stay put.
    setLocalFilters((prev) => {
      const next: ExplorerRowFilter[] = [];
      let i = 0;
      for (const f of prev) {
        if (f.disabled) {
          next.push(f);
        } else if (i < value.length) {
          next.push({
            ...value[i++],
            _localId: f._localId,
            disabled: false,
            collapsed: f.collapsed,
          });
        }
        // else: dropped externally, so drop it locally too
      }
      while (i < value.length) {
        next.push({
          ...value[i++],
          _localId: assignId(),
          disabled: false,
          collapsed: false,
        });
      }
      return next;
    });
    // assignId is a stable ref bump, not reactive
  }, [value]);

  const commit = useCallback(
    (filters: ExplorerRowFilter[]) => {
      const valid = filters.filter((f) => !f.disabled).map(toRowFilter);
      lastCommittedRef.current = valid;
      setValue(valid);
    },
    [setValue],
  );

  return (
    <Flex direction="column" gap="2" width="100%">
      {localFilters.length > 0 ? <Text weight="medium">Filters</Text> : null}
      {localFilters.map((filter, i) => (
        <ExplorerFilterRow
          key={filter._localId}
          filter={filter}
          index={i}
          localFilters={localFilters}
          columnSource={columnSource}
          onUpdate={(updates, shouldCommit = true) => {
            const newFilters = localFilters.map((f, idx) =>
              idx === i ? { ...f, ...updates } : f,
            );
            setLocalFilters(newFilters);
            if (shouldCommit) commit(newFilters);
          }}
          onDelete={() => {
            const newFilters = localFilters.filter((_, idx) => idx !== i);
            setLocalFilters(newFilters);
            commit(newFilters);
          }}
        />
      ))}
    </Flex>
  );
}
