import React, { useState } from "react";
import { ExperimentInterface } from "back-end/types/experiment";
import { DimensionInterface } from "back-end/types/dimension";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import TwoAxisTable from "@/components/TwoAxisTable/TwoAxisTable";
import { useDefinitions } from "@/services/DefinitionsContext";

interface DimensionExplorerProps {
  experiment: ExperimentInterface;
}

export default function DimensionExplorer({
  experiment,
}: DimensionExplorerProps) {
  const { dimensions } = useDefinitions();
  const [rowDimension, setRowDimension] = useState<string>("");
  const [columnDimension, setColumnDimension] = useState<string>("");

  // Get dimension objects from IDs
  const getDimension = (id: string): DimensionInterface | undefined => {
    if (id.startsWith("pre:")) return undefined; // Built-in dimensions
    return dimensions.find((d) => d.id === id);
  };

  // Transform dimension data into table format
  const getTableData = () => {
    const rowDim = getDimension(rowDimension);
    const colDim = getDimension(columnDimension);

    // TODO: Replace with actual experiment results data
    // This is a placeholder structure
    const cells: any[] = [];

    return {
      axis1: {
        id: "row",
        name: rowDim?.name || "Row Dimension",
        values: [], // TODO: Add actual dimension values
        sortOrder: 0,
      },
      axis2: columnDimension
        ? {
            id: "column",
            name: colDim?.name || "Column Dimension",
            values: [], // TODO: Add actual dimension values
            sortOrder: 1,
          }
        : undefined,
      data: cells,
    };
  };

  return (
    <div className="dimension-explorer">
      <div className="dimension-selectors mb-4">
        <div className="row">
          <div className="col-md-6">
            <DimensionChooser
              value={rowDimension}
              setValue={setRowDimension}
              datasourceId={experiment.datasource}
              showHelp={true}
            />
          </div>
          <div className="col-md-6">
            <DimensionChooser
              value={columnDimension}
              setValue={setColumnDimension}
              datasourceId={experiment.datasource}
              showHelp={true}
            />
          </div>
        </div>
      </div>

      {rowDimension && (
        <div className="results-table">
          <TwoAxisTable {...getTableData()} />
        </div>
      )}
    </div>
  );
}
