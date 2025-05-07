import React, { useState } from "react";
import { Box, Flex, Text, Grid } from "@radix-ui/themes";
import { ExperimentInterface } from "back-end/types/experiment";
import { DimensionInterface } from "back-end/types/dimension";
import { useDefinitions } from "@/services/DefinitionsContext";
import Table, {
  TableHeader,
  TableRow,
  TableColumnHeader,
  TableBody,
  TableCell,
} from "@/components/Radix/Table";
import SelectField from "@/components/Forms/SelectField";

interface TableAxis {
  id: string;
  name: JSX.Element;
  values: AxisValue[];
  sortOrder: number; // For maintaining axis order
}

interface AxisValue {
  id: string;
  value: JSX.Element;
  overallCellValue?: JSX.Element;
  sortOrder: number; // For maintaining value order within axis
}

interface TableCell {
  id: string;
  rowAxisValueId: string; // Reference to row axis value
  columnAxisValueId: string; // Reference to column axis value
  value: any; // The actual cell value
  className?: string;
}

interface TwoAxisTable {
  id: string;
  rowAxis: TableAxis;
  columnAxis: TableAxis | undefined;
  cells: TableCell[];
}

export interface TwoAxisTableProps {
  axis1: TableAxis;
  axis2?: TableAxis;
  data: TableCell[];
}

export default function TwoAxisTable({
  axis1,
  axis2,
  data,
}: TwoAxisTableProps) {
  // Sort axis values by sortOrder
  // Could sort by value or secondary value
  const sortedRowValues = [...axis1.values].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );
  const sortedColumnValues = axis2
    ? [...axis2.values].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
    const sortedColumnCellValues = axis2
    ? [...axis2.values].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  // Define grid columns
  // 1st column: axis2 name (optional, vertical)
  // 2nd column: axis1 values (row headers)
  // Remaining columns: axis2 values (column headers/data)
  const templateColumns = `${axis2 ? "auto" : ""} auto repeat(${axis2 ? sortedColumnValues.length : 1}, 1fr)`;

  const cellBaseStyle: React.CSSProperties = {
    padding: "var(--space-2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center", // Center content by default
  };

  return (
    <Grid
      className="two-axis-table"
      style={{ 
        gridTemplateColumns: templateColumns, 
      }}
    >
      {/* Row 1: Empty cell (if axis2 exists for vertical header), axis1.name */}
      {axis2 && <Box style={{...cellBaseStyle, gridColumn: "1", gridRow: "1 / span 2", backgroundColor: "transparent"}}></Box> /* Top-left spacer for vertical header column */}
      <Box style={{...cellBaseStyle, gridRow: "1", gridColumn: axis2? "2" : "1", backgroundColor: "transparent" }}></Box> {/* Spacer above axis1 values / or first part of axis1 name header*/}
      <Box
        style={{ 
          ...cellBaseStyle, 
          gridRow: "1",
          gridColumn: `${axis2 ? "3" : "2"} / span ${axis2?.values.length ?? 1}`,
          justifyContent: "center", // Explicitly center axis name
        }}
        className="axis-cell"
      >
        <Text weight="bold">{axis1.name}</Text>
      </Box>

      {/* Row 2: axis2 values or "Value" */}
      {/* Cell for axis1 values header (above the actual values) - this becomes the top-left-most header if no axis2 */}
      <Box 
        style={{
            ...cellBaseStyle,
            gridRow: "2",
            gridColumn: axis2 ? "2" : "1",
        }}
        className="axis-cell"
      >
        {/* This cell is intentionally left blank if axis2 exists, 
             because axis1.name is above. If no axis2, this could be a spot for a general label or remain blank.
             For now, it's a structural placeholder.
        */}
      </Box>

      {axis2 ? (
        sortedColumnValues.map((colValue, index) => (
          <Box 
            key={colValue.id} 
            style={{
                ...cellBaseStyle,
                gridRow: "2",
                gridColumn: (index + 3).toString(), // Start from column 3
            }}
            className="axis-cell"
          >
            {colValue.value}
          </Box>
        ))
      ) : (
        <Box 
            style={{
                ...cellBaseStyle,
                gridRow: "2",
                gridColumn: "2", // Value is in the second column if no axis2
            }}
            className="axis-cell"
        >
            Value
        </Box>
      )}

      {sortedColumnCellValues ? sortedColumnCellValues.map((colValue, index) => (
        <Box key={colValue.id} style={{...cellBaseStyle, gridRow: "3", gridColumn: (index + 3).toString()}}>
          {colValue.overallCellValue}
        </Box>
      )) : null}

      {/* Data Rows start from Grid Row 3 */}
      {/* Vertical axis2.name header, spans all data rows */}
      {axis2 && (
        <Box
          className="axis-cell vertical"
          style={{
            ...cellBaseStyle, // Apply base styles
            gridColumn: "1", // First column
            gridRow: `4 / span ${sortedRowValues.length}`, // Span data rows
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            whiteSpace: "nowrap",
            alignSelf: "stretch", 
            justifySelf: "stretch", 
          }}
        >
          <Text weight="bold">{axis2.name}</Text>
        </Box>
      )}
      
      {/* Subsequent rows: rowValue header and data cells */}
      {sortedRowValues.map((rowValue, rowIndex) => (
        <React.Fragment key={rowValue.id}>
          {/* Row header (axis1 value) */}
          <Box 
            style={{
                ...cellBaseStyle,
                gridRow: (rowIndex + 4).toString(), // Start from row 3
                gridColumn: axis2 ? "2" : "1", // Second column if axis2 exists, otherwise first
                justifyContent: "flex-start", // Align row headers to the start
            }}
            className="axis-cell"
          >
            {rowValue.value}
          </Box>

          {/* Data cells */}
          {axis2 ? (
            sortedColumnValues.map((colValue, colIndex) => {
              const cell = data.find(
                (c) =>
                  c.rowAxisValueId === rowValue.id &&
                  c.columnAxisValueId === colValue.id
              );
              return (
                <Box
                  key={colValue.id}
                  className={`border-cell data-cell ${cell?.className ?? ""}`}
                  style={{ 
                      ...cellBaseStyle,
                      gridRow: (rowIndex + 4).toString(),
                      gridColumn: (colIndex + 3).toString(), // Start from column 3
                  }}
                >
                  {cell?.value ?? ""}
                </Box>
              );
            })
          ) : (
            <Box 
              className={`border-cell data-cell ${data.find((c) => c.rowAxisValueId === rowValue.id)?.className ?? ""}`}
              style={{
                ...cellBaseStyle,
                gridRow: (rowIndex + 3).toString(),
                gridColumn: "2", // Data is in the second column if no axis2
              }}
            >
              {data.find((c) => c.rowAxisValueId === rowValue.id)?.value ?? ""}
            </Box>
          )}
        </React.Fragment>
      ))}
    </Grid>
  );
}
