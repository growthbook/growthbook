import { Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Text from "@/ui/Text";
import {
  ExplorerFilterRow,
  type ExplorerRowFilter,
  type FilterColumnSource,
} from "./ExplorerFilterRow";

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

  const validFilters = useMemo(
    () => localFilters.filter((f) => !f.disabled),
    [localFilters],
  );

  useEffect(() => {
    if (value.length > validFilters.length) {
      setLocalFilters((prev) => [
        ...prev,
        ...value.slice(validFilters.length).map((f) => ({
          ...f,
          _localId: assignId(),
          disabled: false,
          collapsed: false,
        })),
      ]);
    }
  }, [value, validFilters.length]);

  const commit = useCallback(
    (filters: ExplorerRowFilter[]) => {
      const valid = filters.filter((f) => !f.disabled);
      setValue(valid.map(toRowFilter));
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
