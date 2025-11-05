import { ReactNode, useMemo } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { DataVizConfig } from "back-end/src/validators/saved-queries";
import Tooltip from "@/components/Tooltip/Tooltip";
import Table, {
  TableBody,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableCell,
} from "@/ui/Table";

type HeaderCell = {
  name: string;
  colSpan?: number;
  rowSpan?: number;
};

type CellData = {
  value?: string | number; // If undefined, the cell is skipped when rendering - this is necessary for nesting
  rowSpan?: number; // Only set on cells that should span multiple rows
  opacity?: number; // Opacity percentage (0-100) for background color, only set on data cells with metadata
  metadata?: Record<string, string | number>; // Stores data for tooltip
};

type PivotTableData = {
  columns: HeaderCell[][];
  rows: CellData[][];
};

function PivotTableTooltip({
  cellData,
  children,
}: {
  cellData: CellData;
  children: ReactNode;
}) {
  if (!cellData.value) return <>{children}</>;

  return (
    <Tooltip
      shouldDisplay={cellData.metadata ? true : false}
      body={
        !cellData.metadata ? (
          ""
        ) : (
          <Flex direction="column" gap="2">
            {Object.entries(cellData.metadata).map(([key, value]) => (
              <Flex direction="row" align="center" justify="between" key={key}>
                <Text className="font-bold pr-4">{key}</Text>
                <Text className="pl-4">{value}</Text>
              </Flex>
            ))}
          </Flex>
        )
      }
    >
      {children}
    </Tooltip>
  );
}

// Helper: Create a formatter function for x-axis values
function formatXValue(
  isDateType: boolean,
  xConfig: { dateAggregationUnit?: string } | null,
): (xVal: Date | string) => string {
  return (xVal: Date | string): string => {
    if (isDateType && xVal instanceof Date) {
      const unit = xConfig?.dateAggregationUnit || "none";
      const d = xVal;
      switch (unit) {
        case "second":
          return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(d);
        case "minute":
          return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }).format(d);
        case "hour":
          return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
          }).format(d);
        case "day":
          return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
          }).format(d);
        case "week": {
          // Use Monday as the start of the week
          const day = d.getDay();
          const diffToMonday = (day + 6) % 7; // 0 for Monday, 6 for Sunday
          const start = new Date(d);
          start.setHours(0, 0, 0, 0);
          start.setDate(d.getDate() - diffToMonday);
          return `Week of ${new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
          }).format(start)}`;
        }
        case "month":
          return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
          }).format(d);
        case "year":
          return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
          }).format(d);
        case "none":
        default:
          return d.toLocaleDateString();
      }
    }
    return String(xVal);
  };
}

// Helper: Extract metadata from aggregatedRows
type ExtractedMetadata = {
  dimensionFields: string[];
  xAxisFields: string[];
  dimensionValuesByCombo: Record<string, Record<string, string>>;
  isDateType: boolean;
  formatXValue: (xVal: Date | string) => string;
};

function extractMetadata(
  aggregatedRows: Record<string, unknown>[],
  dataVizConfig: Partial<DataVizConfig>,
): ExtractedMetadata {
  const firstRow = aggregatedRows[0];
  const dimensionFields =
    (firstRow._dimensionFields as string[] | undefined) || [];
  const xAxisFields = (firstRow._xAxisFields as string[] | undefined) || [];
  const dimensionValuesByCombo =
    (firstRow._dimensionValuesByCombo as
      | Record<string, Record<string, string>>
      | undefined) || {};

  const xConfig =
    dataVizConfig.chartType === "pivot-table" && dataVizConfig.xAxes
      ? dataVizConfig.xAxes[0]
      : null;
  const isDateType = xConfig?.type === "date";

  return {
    dimensionFields,
    xAxisFields,
    dimensionValuesByCombo,
    isDateType,
    formatXValue: formatXValue(isDateType, xConfig),
  };
}

// Helper: Get pre-calculated pivot metadata (if available)
function getPivotMetadata(firstRow: Record<string, unknown>): {
  dimensionPaths: string[][];
  rowSpans: Record<string, number>;
  dimensionFields: string[];
} | null {
  const paths = firstRow._pivotDimensionPaths as string[][] | undefined;
  const rowSpans = firstRow._pivotRowSpans as
    | Record<string, number>
    | undefined;
  const fields = firstRow._pivotDimensionFields as string[] | undefined;

  if (paths && rowSpans && fields) {
    return { dimensionPaths: paths, rowSpans, dimensionFields: fields };
  }
  return null;
}

// Helper: Get sorted x-axis values
function getSortedXValues(
  aggregatedRows: Record<string, unknown>[],
  isDateType: boolean,
): (Date | string)[] {
  const xValuesRaw = Array.from(
    new Set(
      aggregatedRows.map((row) => {
        const xVal = row.x;
        if (isDateType && xVal instanceof Date) {
          return xVal;
        }
        return String(xVal);
      }),
    ),
  );

  return xValuesRaw.sort((a, b) => {
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime();
    }
    return String(a).localeCompare(String(b));
  });
}

// Helper: Build lookup map for aggregated rows (avoids repeated searches)
function buildAggregatedRowLookup(
  aggregatedRows: Record<string, unknown>[],
  isDateType: boolean,
): Map<string | number, Record<string, unknown>> {
  const lookup = new Map<string | number, Record<string, unknown>>();
  aggregatedRows.forEach((row) => {
    const key =
      isDateType && row.x instanceof Date ? row.x.getTime() : String(row.x);
    lookup.set(key, row);
  });
  return lookup;
}

// Helper: Build column headers
function buildColumnHeaders(
  dimensionFields: string[],
  xValues: (Date | string)[],
  formatXValue: (xVal: Date | string) => string,
): HeaderCell[][] {
  if (dimensionFields.length > 0) {
    return [
      [
        ...dimensionFields.map((field) => ({ name: field })),
        ...xValues.map((xVal) => ({ name: formatXValue(xVal) })),
      ],
    ];
  }
  return [xValues.map((xVal) => ({ name: formatXValue(xVal) }))];
}

// Helper: Calculate min/max values for opacity calculation
function calculateValueRange(rows: CellData[][]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;

  rows.forEach((row) => {
    row.forEach((cell) => {
      const value = cell.value;
      // Only consider numeric values (skip empty strings and undefined)
      if (typeof value === "number" && Number.isFinite(value)) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    });
  });

  // If all values are the same or no valid values found, return 0-1 range
  if (min === Infinity || max === -Infinity || min === max) {
    return { min: 0, max: 1 };
  }

  return { min, max };
}

// Helper: Calculate opacity percentage (0-100) for a value
function calculateOpacity(value: number, min: number, max: number): number {
  if (min === max) return 100;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;

  // Normalize to 0-1 range, then convert to percentage
  const normalized = (value - min) / (max - min);
  // Return as percentage (0-100)
  return Math.round(normalized * 100);
}

// Helper: Build rows with dimensions
function buildRowsWithDimensions(
  leafPaths: string[][],
  dimensionFields: string[],
  xValues: (Date | string)[],
  dimensionValuesByCombo: Record<string, Record<string, string>>,
  aggregatedRowLookup: Map<string | number, Record<string, unknown>>,
  isDateType: boolean,
  formatXValue: (xVal: Date | string) => string,
  xAxisFields: string[],
  preCalculatedRowSpans?: Record<string, number>,
): CellData[][] {
  // Use pre-calculated rowSpans if available, otherwise calculate on the fly
  const getRowSpan = (path: string[], depth: number): number => {
    if (preCalculatedRowSpans) {
      const key = path.slice(0, depth + 1).join("/");
      return preCalculatedRowSpans[key] ?? 1;
    }
    // Fallback: calculate on the fly (for backward compatibility)
    if (depth === dimensionFields.length - 1) return 1;
    const matchingLeaves = leafPaths.filter((leaf) =>
      leaf.slice(0, depth + 1).every((val, idx) => val === path[idx]),
    );
    return matchingLeaves.length;
  };

  const resultRows = leafPaths.map((path, leafIndex) => {
    const rowCells: CellData[] = [];

    // Build dimension cells with rowSpan
    path.forEach((dimValue, depth) => {
      const isFirstInGroup =
        leafIndex === 0 ||
        leafPaths[leafIndex - 1][depth] !== dimValue ||
        (depth > 0 && leafPaths[leafIndex - 1][depth - 1] !== path[depth - 1]);

      if (isFirstInGroup) {
        rowCells.push({
          value: dimValue,
          rowSpan: getRowSpan(path, depth),
        });
      } else {
        rowCells.push({}); // Empty cell (skipped due to rowSpan)
      }
    });

    // Build data cells for each xAxis value
    const comboKey = path.join(", ");
    const dimensionValues = dimensionValuesByCombo[comboKey] || {};

    xValues.forEach((xVal) => {
      const lookupKey =
        isDateType && xVal instanceof Date ? xVal.getTime() : String(xVal);
      const aggregatedRow = aggregatedRowLookup.get(lookupKey);

      const cellValue =
        aggregatedRow && comboKey in aggregatedRow
          ? (aggregatedRow[comboKey] as number)
          : undefined;

      // Opacity will be calculated after all rows are built
      rowCells.push({
        value: cellValue !== undefined ? cellValue : "",
        metadata: {
          ...dimensionValues,
          [xAxisFields[0] || "x"]: formatXValue(xVal),
          value: cellValue ?? 0,
          // Opacity will be set after calculating min/max across all cells
        },
      });
    });

    return rowCells;
  });

  // Calculate opacity for all data cells based on value range
  const valueRange = calculateValueRange(resultRows);
  resultRows.forEach((row) => {
    row.forEach((cell) => {
      // Only add opacity to data cells (cells with numeric values and metadata)
      if (
        typeof cell.value === "number" &&
        Number.isFinite(cell.value) &&
        cell.metadata
      ) {
        cell.opacity = calculateOpacity(
          cell.value,
          valueRange.min,
          valueRange.max,
        );
      }
    });
  });

  return resultRows;
}

// Helper: Build rows without dimensions
function buildRowsWithoutDimensions(
  xValues: (Date | string)[],
  aggregatedRowLookup: Map<string | number, Record<string, unknown>>,
  isDateType: boolean,
  formatXValue: (xVal: Date | string) => string,
  xAxisFields: string[],
): CellData[][] {
  const rowCells: CellData[] = xValues.map((xVal) => {
    const lookupKey =
      isDateType && xVal instanceof Date ? xVal.getTime() : String(xVal);
    const aggregatedRow = aggregatedRowLookup.get(lookupKey);
    const cellValue = aggregatedRow?.y as number | undefined;

    return {
      value: cellValue !== undefined ? cellValue : "",
      metadata: {
        [xAxisFields[0] || "x"]: formatXValue(xVal),
        value: cellValue ?? 0,
        // Opacity will be set after calculating min/max across all cells
      },
    };
  });

  const resultRows = [rowCells];

  // Calculate opacity for all data cells based on value range
  const valueRange = calculateValueRange(resultRows);
  resultRows.forEach((row) => {
    row.forEach((cell) => {
      // Only add opacity to data cells (cells with numeric values and metadata)
      if (
        typeof cell.value === "number" &&
        Number.isFinite(cell.value) &&
        cell.metadata
      ) {
        cell.opacity = calculateOpacity(
          cell.value,
          valueRange.min,
          valueRange.max,
        );
      }
    });
  });

  return resultRows;
}

// Main transformation function
function formatDataForPivotTable(
  aggregatedRows: Record<string, unknown>[],
  dataVizConfig: Partial<DataVizConfig>,
): PivotTableData {
  if (!aggregatedRows || aggregatedRows.length === 0) {
    return { columns: [], rows: [] };
  }

  // Step 1: Extract metadata
  const metadata = extractMetadata(aggregatedRows, dataVizConfig);

  // Step 2: Get sorted x-axis values
  const xValues = getSortedXValues(aggregatedRows, metadata.isDateType);

  // Step 3: Build lookup map for efficient row access
  const aggregatedRowLookup = buildAggregatedRowLookup(
    aggregatedRows,
    metadata.isDateType,
  );

  // Step 4: Build column headers
  const columns = buildColumnHeaders(
    metadata.dimensionFields,
    xValues,
    metadata.formatXValue,
  );

  // Step 5: Build rows (with or without dimensions)
  const pivotMetadata = getPivotMetadata(aggregatedRows[0]);
  const rows =
    metadata.dimensionFields.length > 0
      ? (() => {
          // Use pre-calculated paths if available, otherwise build from scratch
          const leafPaths =
            pivotMetadata?.dimensionPaths ||
            (() => {
              // Fallback: build tree from dimension combos (for backward compatibility)
              type DimensionNode = {
                name: string;
                children?: Map<string, DimensionNode>;
              };
              const tree = new Map<string, DimensionNode>();
              const dimensionCombos = Object.keys(
                metadata.dimensionValuesByCombo,
              );

              dimensionCombos.forEach((comboKey) => {
                const values = metadata.dimensionValuesByCombo[comboKey];
                const valuesList = metadata.dimensionFields.map(
                  (field) => values[field] || "",
                );
                let currentLevel = tree;
                valuesList.forEach((value, depth) => {
                  if (!currentLevel.has(value)) {
                    currentLevel.set(value, { name: value });
                  }
                  const node = currentLevel.get(value)!;
                  if (depth < valuesList.length - 1) {
                    if (!node.children) {
                      node.children = new Map();
                    }
                    currentLevel = node.children;
                  }
                });
              });

              const getLeafPaths = (
                node: DimensionNode,
                path: string[],
              ): string[][] => {
                const fullPath = [...path, node.name];
                if (!node.children || node.children.size === 0) {
                  return [fullPath];
                }
                const leaves: string[][] = [];
                node.children.forEach((child) => {
                  leaves.push(...getLeafPaths(child, fullPath));
                });
                return leaves;
              };

              const paths: string[][] = [];
              tree.forEach((node) => {
                paths.push(...getLeafPaths(node, []));
              });

              return paths.sort((a, b) => {
                for (let i = 0; i < Math.max(a.length, b.length); i++) {
                  const aVal = a[i] || "";
                  const bVal = b[i] || "";
                  const cmp = aVal.localeCompare(bVal);
                  if (cmp !== 0) return cmp;
                }
                return 0;
              });
            })();

          // Build rows with dimensions
          return buildRowsWithDimensions(
            leafPaths,
            metadata.dimensionFields,
            xValues,
            metadata.dimensionValuesByCombo,
            aggregatedRowLookup,
            metadata.isDateType,
            metadata.formatXValue,
            metadata.xAxisFields,
            pivotMetadata?.rowSpans,
          );
        })()
      : buildRowsWithoutDimensions(
          xValues,
          aggregatedRowLookup,
          metadata.isDateType,
          metadata.formatXValue,
          metadata.xAxisFields,
        );

  return { columns, rows };
}

export default function PivotTable({
  dataVizConfig,
  aggregatedRows,
}: {
  dataVizConfig: Partial<DataVizConfig>;
  aggregatedRows: Record<string, unknown>[];
}) {
  // Transform aggregatedRows to PivotTableData format
  const data = useMemo(
    () => formatDataForPivotTable(aggregatedRows, dataVizConfig),
    [aggregatedRows, dataVizConfig],
  );

  return (
    <div className="px-2 py-4">
      <h4 className="text-center mb-4">{dataVizConfig.title}</h4>
      <Table variant="surface" size="1">
        <TableHeader>
          {data.columns.map((headerRow, rowIndex) => (
            <TableRow key={rowIndex}>
              {headerRow.map((cell, cellIndex) => (
                <TableColumnHeader
                  key={`${rowIndex}-${cellIndex}`}
                  colSpan={cell.colSpan}
                  rowSpan={cell.rowSpan}
                  className="border-left border-right"
                >
                  {cell.name}
                </TableColumnHeader>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {data.rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, cellIndex) => {
                // Skip cells where value is undefined (used for rowSpan skipping)
                if (cell.value === undefined) return null;
                return (
                  <TableCell
                    key={cellIndex}
                    rowSpan={cell.rowSpan}
                    className="border-left border-right"
                    style={{
                      background: cell.opacity
                        ? `color-mix(in srgb,  #5071de ${cell.opacity}%, transparent)`
                        : "transparent",
                    }}
                  >
                    <PivotTableTooltip cellData={cell}>
                      {cell.value}
                    </PivotTableTooltip>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
