import { Flex, Box } from "@radix-ui/themes";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import Text from "@/ui/Text";
import useExplorationTableData from "./useExplorationTableData";

export default function SimpleExplorationTable({
  exploration,
  config,
}: {
  exploration: ProductAnalyticsExploration | null;
  config: ExplorationConfig;
}) {
  const {
    rowData,
    orderedColumnKeys,
    headerStructure,
    explorationReturnedNoData,
  } = useExplorationTableData(exploration, config);

  if (exploration?.error) {
    return (
      <Text size="small" color="text-low">
        {exploration.error}
      </Text>
    );
  }

  if (explorationReturnedNoData) {
    return (
      <Text size="small" color="text-low">
        The query ran successfully, but no data was returned.
      </Text>
    );
  }

  const useTwoRowHeader = headerStructure != null;

  return (
    <Box
      style={{
        maxHeight: 360,
        overflow: "auto",
        borderRadius: "var(--radius-2)",
        border: "1px solid var(--gray-a4)",
      }}
    >
      <Flex align="center" gap="2" px="3" py="2">
        <Text size="small" color="text-low" weight="medium">
          {rowData.length} {rowData.length === 1 ? "row" : "rows"}
        </Text>
      </Flex>
      <table
        className="table table-bordered gbtable table-hover mb-0"
        style={{ fontSize: "var(--font-size-1)" }}
      >
        <thead
          style={{
            position: "sticky",
            top: -1,
            zIndex: 2,
            backgroundColor: "var(--color-panel-solid)",
          }}
        >
          {useTwoRowHeader && headerStructure ? (
            <>
              <tr>
                {headerStructure.row1.map((cell, idx) => (
                  <th
                    key={idx}
                    rowSpan={cell.rowSpan}
                    colSpan={cell.colSpan ?? 1}
                  >
                    {cell.label}
                  </th>
                ))}
              </tr>
              <tr>
                {headerStructure.row2Labels.map((label, idx) => (
                  <th key={idx}>{label}</th>
                ))}
              </tr>
            </>
          ) : (
            <tr>
              {orderedColumnKeys.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {rowData.map((row, i) => (
            <tr key={i}>
              {orderedColumnKeys.map((key, j) => (
                <td key={j}>{row[key] != null ? String(row[key]) : ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}
