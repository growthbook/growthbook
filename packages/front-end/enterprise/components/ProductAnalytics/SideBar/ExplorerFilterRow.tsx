import { Box, Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import { PiCaretDown, PiCaretUp, PiX } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import {
  reshapeDateValuesOnOperatorChange,
  hideTimeColumn,
  getRowFilterColumnChange,
  getRowFilterInputState,
  getRowFilterSelectOptions,
  getRowFilterSelectValue,
  type FilterColumnSource,
} from "@/components/FactTables/rowFilterUtils";
import { RowFilterValueInput } from "@/components/FactTables/RowFilterValueInput";

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
  const columnOptions = columnSource.columns.filter(
    (o) =>
      !hideTimeColumn({
        column: o.value,
        timeColumn: columnSource.timeColumn,
        selectedColumn: filter.column,
      }),
  );

  if (
    filter.operator !== "saved_filter" &&
    filter.column &&
    !columnOptions.find((o) => o.value === filter.column)
  ) {
    columnOptions.push({
      label: `${filter.column} (Invalid)`,
      value: filter.column,
    });
  }

  const firstSelectOptions = getRowFilterSelectOptions({
    columnOptions,
    savedFilters: columnSource.savedFilters,
    selectedSavedFilterId:
      filter.operator === "saved_filter" ? filter.values?.[0] : undefined,
  });

  const { datatype, topValues } = columnSource.getColumnInfo(filter.column);
  const state = getRowFilterInputState({
    operator: filter.operator,
    values: filter.values,
    datatype,
    topValues,
  });

  const isSqlExpr = filter.operator === "sql_expr";
  const firstSelectCompleted = !state.operatorInputRequired || !!filter.column;
  const autoFocus = index === localFilters.length - 1;

  const columnSelect = (
    <SelectField
      size="small"
      value={getRowFilterSelectValue(filter)}
      onChange={(v) =>
        onUpdate(
          getRowFilterColumnChange(
            v,
            filter,
            columnSource.getColumnInfo(v).datatype,
          ),
        )
      }
      options={firstSelectOptions}
      autoFocus={autoFocus}
      sort={false}
      placeholder="Filter by..."
      required
    />
  );

  const operatorSelect = state.operatorInputRequired &&
    firstSelectCompleted && (
      <SelectField
        size="small"
        value={state.displayOperator}
        onChange={(v: RowFilter["operator"]) => {
          let newValues = filter.values || [];
          if (
            ["in", "not_in"].includes(v) &&
            !["in", "not_in"].includes(filter.operator)
          ) {
            newValues = newValues.filter((val) => val !== "");
          }
          newValues = reshapeDateValuesOnOperatorChange(
            newValues,
            filter.operator,
            v,
            state.isDateColumn,
          );
          onUpdate({ operator: v, values: newValues });
        }}
        options={state.operatorOptions}
        sort={false}
        placeholder="Select operator..."
        required
      />
    );

  const valueInput = state.valueInputRequired && firstSelectCompleted && (
    <RowFilterValueInput
      state={state}
      operator={filter.operator}
      values={filter.values}
      onChange={(values, commit) => onUpdate({ values }, commit)}
      autoFocus={autoFocus}
    />
  );

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
          {isSqlExpr ? null : operatorSelect ? (
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
        </Flex>
      </Collapsible>
    </Flex>
  );
}
