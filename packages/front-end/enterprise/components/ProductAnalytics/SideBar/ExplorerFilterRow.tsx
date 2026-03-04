import { Flex } from "@radix-ui/themes";
import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { PiCaretDown, PiCaretUp, PiX } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import {
  getAllowedOperators,
  operatorLabelMap,
  NUMBER_PATTERN,
  numberRegex,
  getColumnInfo,
} from "@/components/FactTables/rowFilterUtils";

const NUMBER_PARTIAL_PATTERN = /^-?\.?$|^-?\d*\.?\d*$/;

/** Normalised column source so the filter row works for both fact tables and raw data sources. */
export interface FilterColumnSource {
  columns: SingleValue[];
  savedFilters: { id: string; name: string }[];
  getColumnInfo: (column: string | undefined) => {
    datatype: string;
    topValues: string[];
  };
}

export function factTableToColumnSource(
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">,
): FilterColumnSource {
  const columns: SingleValue[] = [];
  factTable.columns.forEach((col) => {
    if (col.datatype === "date") return;
    if (factTable.userIdTypes?.includes(col.column)) return;
    if (col.deleted) return;

    columns.push({ label: col.name || col.column, value: col.column });

    if (col.jsonFields) {
      Object.keys(col.jsonFields).forEach((field) => {
        columns.push({
          label: `${col.name || col.column}.${field}`,
          value: `${col.column}.${field}`,
        });
      });
    }
  });

  return {
    columns,
    savedFilters: factTable.filters.map((f) => ({ id: f.id, name: f.name })),
    getColumnInfo: (column) => getColumnInfo(factTable, column),
  };
}

export function columnTypesToColumnSource(
  columnTypes: Record<
    string,
    "string" | "number" | "date" | "boolean" | "other"
  >,
): FilterColumnSource {
  const columns = Object.entries(columnTypes)
    .filter(([, datatype]) => datatype !== "date")
    .map(([col]) => ({ label: col, value: col }));

  return {
    columns,
    savedFilters: [],
    getColumnInfo: (column) => {
      if (!column || !(column in columnTypes))
        return { datatype: "", topValues: [] };
      return { datatype: columnTypes[column], topValues: [] };
    },
  };
}

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
  const columnOptions = [...columnSource.columns];

  if (filter.column && !columnOptions.find((o) => o.value === filter.column)) {
    columnOptions.push({
      label: `${filter.column} (Invalid)`,
      value: filter.column,
    });
  }

  const firstSelectOptions: GroupedValue[] = [
    { label: "Columns", options: columnOptions },
    {
      label: "Other",
      options: [
        { label: "SQL Expression", value: "$$sql_expr" },
        ...(columnSource.savedFilters.length > 0 ||
        filter.operator === "saved_filter"
          ? [{ label: "Saved Filter", value: "$$saved_filter" }]
          : []),
      ],
    },
  ];

  const operatorInputRequired =
    filter.operator !== "sql_expr" && filter.operator !== "saved_filter";

  const firstSelectCompleted = !operatorInputRequired || !!filter.column;

  const operatorOptions: SingleValue[] = [];
  const valueOptions: SingleValue[] = [];
  let allowCreatingNewOptions = true;

  if (filter.operator === "saved_filter") {
    allowCreatingNewOptions = false;
    valueOptions.push(
      ...columnSource.savedFilters.map((f) => ({
        label: f.name,
        value: f.id,
      })),
    );
    if (
      filter.values?.[0] &&
      !columnSource.savedFilters.find((f) => f.id === filter.values?.[0])
    ) {
      valueOptions.push({
        label: `${filter.values[0]} (Deleted)`,
        value: filter.values[0],
      });
    }
  }

  let inputType: "text" | "number" = "text";
  let displayOperator = filter.operator;

  if (operatorInputRequired) {
    const { datatype, topValues } = columnSource.getColumnInfo(filter.column);

    const allowedOperators = getAllowedOperators(datatype);

    if (datatype === "number") {
      inputType = "number";
    }

    if (topValues) {
      topValues.forEach((v) => {
        if (v) valueOptions.push({ label: v, value: v });
      });
    }

    if (datatype === "boolean" && filter.operator === "=") {
      displayOperator = filter.values?.[0] === "true" ? "is_true" : "is_false";
    }

    const operatorsToShow = [...allowedOperators];
    if (!operatorsToShow.includes(displayOperator)) {
      operatorsToShow.push(displayOperator);
    }

    operatorOptions.push(
      ...operatorsToShow.map((op) => ({
        label: operatorLabelMap[op],
        value: op,
      })),
    );
  }

  const valueInputRequired = ![
    "is_true",
    "is_false",
    "is_null",
    "not_null",
  ].includes(filter.operator);

  const multiValueInput = ["in", "not_in"].includes(filter.operator);

  const useValueOptions =
    (valueOptions.length > 0 || !allowCreatingNewOptions) &&
    ["in", "not_in", "=", "!=", "saved_filter"].includes(filter.operator);

  if (useValueOptions) {
    filter.values?.forEach((v) => {
      if (v && !valueOptions.find((o) => o.value === v)) {
        valueOptions.push({ label: v, value: v });
      }
    });
  }

  const autoFocus = index === localFilters.length - 1;

  const columnSelect = (
    <SelectField
      value={
        filter.operator === "sql_expr"
          ? "$$sql_expr"
          : filter.operator === "saved_filter"
            ? "$$saved_filter"
            : filter.column || ""
      }
      onChange={(v) => {
        if (v === "$$sql_expr") {
          onUpdate({ operator: "sql_expr", values: [] });
        } else if (v === "$$saved_filter") {
          onUpdate({ operator: "saved_filter", values: [] });
        } else {
          const { datatype } = columnSource.getColumnInfo(v);
          let newOperator = filter.operator;
          let newValues = filter.values || [];
          const allowedOperators = getAllowedOperators(datatype);

          if (!allowedOperators.includes(newOperator)) {
            newOperator = allowedOperators[0];
            newValues = [];
          }

          if (datatype === "number") {
            newValues = newValues.filter((v) => numberRegex.test(v));
          }

          onUpdate({
            operator: newOperator,
            column: v,
            values: newValues,
          });
        }
      }}
      options={firstSelectOptions}
      autoFocus={autoFocus}
      sort={false}
      placeholder="Select column..."
      required
    />
  );

  const operatorSelect = operatorInputRequired && firstSelectCompleted && (
    <SelectField
      value={displayOperator}
      onChange={(v: RowFilter["operator"]) => {
        let newValues = filter.values || [];
        if (
          ["in", "not_in"].includes(v) &&
          !["in", "not_in"].includes(filter.operator)
        ) {
          newValues = newValues.filter((val) => val !== "");
        }
        onUpdate({ operator: v, values: newValues });
      }}
      options={operatorOptions}
      sort={false}
      placeholder="Select operator..."
      required
    />
  );

  const valueInput = valueInputRequired && firstSelectCompleted && (
    <>
      {multiValueInput && useValueOptions ? (
        <MultiSelectField
          value={filter.values || []}
          onChange={(v) => onUpdate({ values: v })}
          options={valueOptions}
          creatable={allowCreatingNewOptions}
          sort={false}
          autoFocus={autoFocus}
          pattern={inputType === "number" ? NUMBER_PATTERN : undefined}
          placeholder="Select values..."
          required
        />
      ) : multiValueInput ? (
        <StringArrayField
          value={filter.values || []}
          onChange={(v) => onUpdate({ values: v })}
          delimiters={["Enter", "Tab"]}
          autoFocus={autoFocus}
          pattern={inputType === "number" ? NUMBER_PATTERN : undefined}
          required
        />
      ) : useValueOptions ? (
        <SelectField
          value={filter.values?.[0] || ""}
          onChange={(v) => onUpdate({ values: [v] })}
          options={valueOptions}
          createable={allowCreatingNewOptions}
          sort={false}
          autoFocus={autoFocus}
          pattern={inputType === "number" ? NUMBER_PATTERN : undefined}
          placeholder="Select value..."
          required
        />
      ) : (
        <Field
          value={filter.values?.[0] || ""}
          onChange={(e) => {
            const v = e.target.value;
            if (inputType === "number" && v !== "") {
              if (!NUMBER_PARTIAL_PATTERN.test(v)) return;
            }
            onUpdate({ values: [v] }, false);
          }}
          onBlur={(e) => onUpdate({ values: [e.target.value] }, true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onUpdate(
                { values: [(e.target as HTMLInputElement).value] },
                true,
              );
              (e.target as HTMLInputElement).blur();
            }
          }}
          textarea={filter.operator === "sql_expr"}
          minRows={1}
          autoFocus={autoFocus}
          type={inputType === "number" ? "text" : inputType}
          inputMode={inputType === "number" ? "decimal" : undefined}
          required
        />
      )}
    </>
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
        <Text
          size="small"
          truncate
          whiteSpace="nowrap"
          title={getFilterSummary()}
        >
          {getFilterSummary()}
        </Text>
        <Flex align="center" gap="1" style={{ flexShrink: 0 }}>
          <Switch
            value={!filter.disabled}
            onChange={(v) => onUpdate({ disabled: !v }, true)}
          />
          <Button
            size="xs"
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
          <Button size="xs" variant="ghost" onClick={onDelete}>
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
          {columnSelect}
          {operatorSelect}
          {valueInput}
        </Flex>
      </Collapsible>
    </Flex>
  );
}
