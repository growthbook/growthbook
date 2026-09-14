import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import { PiX } from "react-icons/pi";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import {
  getRowFilterColumnChange,
  getRowFilterColumnOptions,
  getRowFilterInputState,
  getRowFilterOperatorChange,
  getRowFilterSelectOptions,
  getRowFilterSelectValue,
  type FilterColumnSource,
} from "./rowFilterUtils";
import { RowFilterValueInput } from "./RowFilterValueInput";

export function RowFilterFields({
  filter,
  columnSource,
  autoFocus,
  dateInputWidth,
  onUpdate,
  children,
}: {
  filter: RowFilter;
  columnSource: FilterColumnSource;
  autoFocus?: boolean;
  dateInputWidth?: number;
  onUpdate: (updates: Partial<RowFilter>, commit?: boolean) => void;
  children: (fields: {
    columnSelect: ReactNode;
    operatorSelect: ReactNode;
    valueInput: ReactNode;
    isSqlExpr: boolean;
  }) => ReactNode;
}) {
  const columnOptions = getRowFilterColumnOptions(columnSource, filter);
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

  const columnSelect = isSqlExpr ? null : (
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
        onChange={(v: RowFilter["operator"]) =>
          onUpdate(getRowFilterOperatorChange(v, filter, state.isDateColumn))
        }
        options={state.operatorOptions}
        sort={false}
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
      dateInputWidth={dateInputWidth}
    />
  );

  return (
    <>
      {children({
        columnSelect,
        operatorSelect,
        valueInput,
        isSqlExpr,
      })}
    </>
  );
}

export function RowFilterEditorRows({
  value,
  setValue,
  columnSource,
  dateInputWidth,
}: {
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  columnSource: FilterColumnSource;
  dateInputWidth?: number;
}) {
  const [rowDeleted, setRowDeleted] = useState(false);

  return (
    <>
      {value.map((filter, i) => {
        const updateRowFilter = (updates: Partial<RowFilter>) => {
          const newFilters = [...value];
          newFilters[i] = { ...filter, ...updates };
          setValue(newFilters);
        };
        const autoFocus = i === value.length - 1;

        return (
          <Flex
            direction="row"
            gap="2"
            key={`${rowDeleted}-${i}`}
            align="center"
          >
            {i > 0 && <div>AND</div>}
            <RowFilterFields
              filter={filter}
              columnSource={columnSource}
              autoFocus={autoFocus}
              dateInputWidth={dateInputWidth}
              onUpdate={updateRowFilter}
            >
              {({ columnSelect, operatorSelect, valueInput, isSqlExpr }) => (
                <>
                  {columnSelect}
                  {operatorSelect}
                  {valueInput &&
                    (isSqlExpr ? (
                      <Box flexGrow="1" minWidth="0">
                        {valueInput}
                      </Box>
                    ) : (
                      valueInput
                    ))}
                </>
              )}
            </RowFilterFields>
            <Button
              variant="ghost"
              color="red"
              icon={<PiX />}
              aria-label="Remove filter"
              onClick={() => {
                const newFilters = [...value];
                newFilters.splice(i, 1);
                setValue(newFilters);
                setRowDeleted(!rowDeleted);
              }}
            >
              {""}
            </Button>
          </Flex>
        );
      })}
    </>
  );
}
