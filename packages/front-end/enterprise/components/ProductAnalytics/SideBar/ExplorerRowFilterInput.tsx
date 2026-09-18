import { Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import { ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { isEqual } from "lodash";
import Text from "@/ui/Text";
import { type FilterColumnSource } from "@/components/FactTables/rowFilterUtils";
import { RowFilterActions } from "@/components/FactTables/RowFilterActions";
import { ExplorerFilterRow, type ExplorerRowFilter } from "./ExplorerFilterRow";

function toRowFilter(f: ExplorerRowFilter): RowFilter {
  const { disabled: _d, collapsed: _c, _localId: _id, ...rest } = f;
  return rest;
}

function withLocalChrome(
  filter: RowFilter,
  localId: number,
): ExplorerRowFilter {
  return {
    ...filter,
    _localId: localId,
    disabled: false,
    collapsed: false,
  };
}

export function ExplorerRowFilterInput({
  value,
  setValue,
  columnSource,
  children,
  showSqlFilter = true,
}: {
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  columnSource: FilterColumnSource;
  children?: ReactNode;
  showSqlFilter?: boolean;
}) {
  const nextIdRef = useRef(0);
  const assignId = () => nextIdRef.current++;

  const [localFilters, setLocalFilters] = useState<ExplorerRowFilter[]>(() =>
    value.map((f) => withLocalChrome(f, assignId())),
  );

  // Ignore our own commits; any other value change is a wholesale replace.
  const lastCommittedRef = useRef<RowFilter[]>(value);

  useEffect(() => {
    if (isEqual(value, lastCommittedRef.current)) return;
    lastCommittedRef.current = value;
    setLocalFilters(value.map((f) => withLocalChrome(f, assignId())));
  }, [value]);

  const commit = useCallback(
    (filters: ExplorerRowFilter[]) => {
      const valid = filters.filter((f) => !f.disabled).map(toRowFilter);
      lastCommittedRef.current = valid;
      setValue(valid);
    },
    [setValue],
  );

  const replaceLocal = (filters: ExplorerRowFilter[]) => {
    setLocalFilters(filters);
    commit(filters);
  };

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
            replaceLocal(localFilters.filter((_, idx) => idx !== i));
          }}
        />
      ))}
      <RowFilterActions
        showSqlFilter={showSqlFilter}
        onAdd={(filter) =>
          replaceLocal([...localFilters, withLocalChrome(filter, assignId())])
        }
      >
        {children}
      </RowFilterActions>
    </Flex>
  );
}
