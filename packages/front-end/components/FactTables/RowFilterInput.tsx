import { Flex } from "@radix-ui/themes";
import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { PiX } from "react-icons/pi";
import { useMemo, useState } from "react";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import {
  reshapeDateValuesOnOperatorChange,
  hideTimeColumn,
  factTableToColumnSource,
  getRowFilterColumnChange,
  getRowFilterInputState,
  getRowFilterSelectOptions,
  getRowFilterSelectValue,
} from "./rowFilterUtils";
import { RowFilterValueInput } from "./RowFilterValueInput";
import { RowFilterActions } from "./RowFilterActions";

export function RowFilterInput({
  value,
  setValue,
  factTable,
  showSampleRows = true,
}: {
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  factTable: Pick<
    FactTableInterface,
    "id" | "columns" | "filters" | "userIdTypes"
  >;
  /** False when rendered inside the sample rows modal, which is this form. */
  showSampleRows?: boolean;
}) {
  const [rowDeleted, setRowDeleted] = useState(false);
  const columnSource = useMemo(
    () => factTableToColumnSource(factTable),
    [factTable],
  );

  return (
    <Flex direction="column" gap="2">
      <strong>Row Filter</strong>
      {value.map((filter, i) => {
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

        const { datatype, topValues } = columnSource.getColumnInfo(
          filter.column,
        );
        const state = getRowFilterInputState({
          operator: filter.operator,
          values: filter.values,
          datatype,
          topValues,
        });

        const isSqlExpr = filter.operator === "sql_expr";
        const firstSelectCompleted =
          !state.operatorInputRequired || !!filter.column;

        const updateRowFilter = (updates: Partial<RowFilter>) => {
          const newFilters = [...value];
          newFilters[i] = { ...filter, ...updates };
          setValue(newFilters);
        };

        // Only auto-focus if it's the last row
        const autoFocus = i === value.length - 1;

        return (
          <Flex
            direction="row"
            gap="2"
            key={`${rowDeleted}-${i}`}
            align="center"
          >
            {i > 0 && <div>AND</div>}
            {isSqlExpr ? null : (
              <SelectField
                size="small"
                value={getRowFilterSelectValue(filter)}
                onChange={(v) =>
                  updateRowFilter(
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
            )}
            {state.operatorInputRequired && firstSelectCompleted && (
              <SelectField
                size="small"
                value={state.displayOperator}
                onChange={(v: RowFilter["operator"]) => {
                  let newValues = filter.values || [];

                  // If changing from a single-value to multi-value operator, remove empty strings
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

                  updateRowFilter({ operator: v, values: newValues });
                }}
                options={state.operatorOptions}
                sort={false}
                required
              />
            )}
            {state.valueInputRequired && firstSelectCompleted && (
              <RowFilterValueInput
                state={state}
                operator={filter.operator}
                values={filter.values}
                onChange={(values) => updateRowFilter({ values })}
                autoFocus={autoFocus}
                dateInputWidth={260}
                sqlContainerClassName="flex-grow-1"
              />
            )}
            <Button
              variant="ghost"
              color="red"
              onClick={() => {
                const newFilters = [...value];
                newFilters.splice(i, 1);
                setValue(newFilters);
                // We use index for key, so force a re-render to avoid issues
                setRowDeleted(!rowDeleted);
              }}
            >
              <PiX />
            </Button>
          </Flex>
        );
      })}
      <RowFilterActions
        value={value}
        setValue={setValue}
        factTableId={factTable.id}
        showSampleRows={showSampleRows}
      />
    </Flex>
  );
}
