import { Box, Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import { PiCaretDown, PiCaretUp, PiX } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import { type FilterColumnSource } from "@/components/FactTables/rowFilterUtils";
import { RowFilterFields } from "@/components/FactTables/RowFilterFields";

/** Front-end only: extends RowFilter with UI state for the explorer. */
export type ExplorerRowFilter = RowFilter & {
  _localId: number;
  disabled?: boolean;
  collapsed?: boolean;
};

export function ExplorerFilterRow({
  filter,
  index,
  localFilters,
  columnSource,
  onUpdate,
  onDelete,
}: {
  filter: ExplorerRowFilter;
  index: number;
  localFilters: ExplorerRowFilter[];
  columnSource: FilterColumnSource;
  onUpdate: (
    updates: Partial<ExplorerRowFilter>,
    shouldCommit?: boolean,
  ) => void;
  onDelete: () => void;
}) {
  const getFilterSummary = () => {
    if (filter.operator === "sql_expr") {
      const sqlExprCount = localFilters
        .slice(0, index + 1)
        .filter((f) => f.operator === "sql_expr").length;
      return `SQL Expression ${sqlExprCount}`;
    }
    if (filter.operator === "saved_filter") {
      const savedFilter = columnSource.savedFilters.find(
        (f) => f.id === filter.values?.[0],
      );
      return savedFilter ? savedFilter.name : "Saved Filter";
    }
    if (!filter.column) {
      return `Filter ${index + 1}`;
    }
    const colOption = columnSource.columns.find(
      (c) => c.value === filter.column,
    );
    const colName = colOption?.label || filter.column;
    return `${colName} ${filter.operator} ${filter.values?.join(", ") || ""}`;
  };

  const autoFocus = index === localFilters.length - 1;

  return (
    <Flex
      direction="column"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-3)",
        padding: "var(--space-2)",
        backgroundColor: "var(--color-panel-translucent)",
        opacity: filter.disabled ? 0.5 : 1,
      }}
    >
      <Flex justify="between" align="center" width="100%" gap="2">
        <Text size="sm" truncate whiteSpace="nowrap" title={getFilterSummary()}>
          {getFilterSummary()}
        </Text>
        <Flex align="center" gap="1" style={{ flexShrink: 0 }}>
          <Switch
            value={!filter.disabled}
            onChange={(v) => onUpdate({ disabled: !v }, true)}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onUpdate({ collapsed: !filter.collapsed }, false)}
            style={{ padding: 2 }}
          >
            {filter.collapsed ? (
              <PiCaretDown size={14} />
            ) : (
              <PiCaretUp size={14} />
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <PiX size={14} />
          </Button>
        </Flex>
      </Flex>
      <Collapsible
        open={!filter.collapsed}
        trigger=""
        triggerDisabled
        transitionTime={100}
      >
        <Flex direction="column" gap="2" mt="2">
          <RowFilterFields
            filter={filter}
            columnSource={columnSource}
            autoFocus={autoFocus}
            onUpdate={(updates, commit) => onUpdate(updates, commit !== false)}
          >
            {({ columnSelect, operatorSelect, valueInput }) => (
              <>
                {columnSelect && operatorSelect ? (
                  <Flex direction="row" gap="2" align="center">
                    <Box flexGrow="1" style={{ minWidth: 0, flexBasis: 0 }}>
                      {columnSelect}
                    </Box>
                    <Box style={{ minWidth: 0, flex: "0 1 130px" }}>
                      {operatorSelect}
                    </Box>
                  </Flex>
                ) : (
                  columnSelect
                )}
                {valueInput}
              </>
            )}
          </RowFilterFields>
        </Flex>
      </Collapsible>
    </Flex>
  );
}
