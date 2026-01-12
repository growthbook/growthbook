import { Box, Flex, Grid, Text } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { PiChartBar } from "react-icons/pi";
import { FaAngleRight } from "react-icons/fa";
import { DataVizConfig } from "shared/validators";
import {
  DashboardBlockInterfaceOrData,
  DataVisualizationBlockInterface,
  chartTypeSupportsAnchorYAxisToZero,
} from "shared/enterprise";
import { normalizeDimensionsForChartType } from "@/services/dataVizConfigUtilities";
import Button from "@/ui/Button";

interface ChartTypeConfigSectionProps {
  block: DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>
  >;
}

// Helper function to remove displaySettings from a config object
function removeDisplaySettings<T extends Partial<DataVizConfig>>(
  config: T,
): Omit<T, "displaySettings"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { displaySettings: _displaySettings, ...rest } = config as T & {
    displaySettings?: unknown;
  };
  return rest;
}

export default function ChartTypeConfigSection({
  block,
  setBlock,
}: ChartTypeConfigSectionProps) {
  const currentDataVizConfig =
    block.dataVizConfig?.[0] || ({} as Partial<DataVizConfig>);
  const currentChartType = currentDataVizConfig.chartType;

  const displayChartType = currentChartType || "bar";

  const handleChartTypeChange = (chartType: DataVizConfig["chartType"]) => {
    if (chartType === "big-value") {
      // If graph type is big value - set defaults
      const configForBigValue: Partial<DataVizConfig> = {
        ...currentDataVizConfig,
        chartType: "big-value",
        format: "shortNumber",
      };
      // Remove displaySettings if it exists (big-value doesn't support it)
      const updatedConfig = removeDisplaySettings(
        configForBigValue,
      ) as Partial<DataVizConfig>;

      setBlock({
        ...block,
        dataVizConfig: [updatedConfig as DataVizConfig],
      });
      return;
    }

    // Update chart type and normalize dimensions if needed
    const updatedConfig = normalizeDimensionsForChartType({
      ...currentDataVizConfig,
      chartType: chartType,
    } as Partial<DataVizConfig>);

    // If the chart type changes to line/scatter & we don't have displaySettings, set the default
    if (
      updatedConfig.chartType &&
      chartTypeSupportsAnchorYAxisToZero(updatedConfig.chartType)
    ) {
      if (
        !("displaySettings" in updatedConfig) ||
        !updatedConfig.displaySettings
      ) {
        setBlock({
          ...block,
          dataVizConfig: [
            {
              ...updatedConfig,
              displaySettings: {
                anchorYAxisToZero: true,
              },
            } as DataVizConfig,
          ],
        });
        return;
      }
    } else {
      // Remove displaySettings for chart types that don't support it
      const configWithoutDisplaySettings = removeDisplaySettings(
        updatedConfig,
      ) as Partial<DataVizConfig>;
      setBlock({
        ...block,
        dataVizConfig: [configWithoutDisplaySettings as DataVizConfig],
      });
      return;
    }

    setBlock({
      ...block,
      dataVizConfig: [updatedConfig as DataVizConfig],
    });
  };

  const chartTypes: Array<{
    value: DataVizConfig["chartType"];
    label: string;
  }> = [
    { value: "bar", label: "Bar" },
    { value: "line", label: "Line" },
    { value: "area", label: "Area" },
    { value: "scatter", label: "Scatter" },
    { value: "big-value", label: "Big Value" },
    { value: "pivot-table", label: "Pivot Table" },
  ];

  return (
    <Collapsible
      open={true}
      transitionTime={100}
      trigger={
        <div
          style={{
            paddingLeft: "12px",
            paddingRight: "12px",
            paddingTop: "12px",
            paddingBottom: "12px",
            borderBottom: "1px solid var(--gray-a3)",
          }}
        >
          <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
            <Flex justify="between" align="center">
              <Flex align="center" gap="1">
                <PiChartBar style={{ color: "var(--violet-11)" }} size={20} />
                Chart Type
              </Flex>
              <FaAngleRight className="chevron" />
            </Flex>
          </Text>
        </div>
      }
    >
      <Box p="4" height="fit-content">
        <Flex direction="column" gap="4">
          <Grid columns="3" gap="2">
            {chartTypes.map(({ value, label }) => {
              const isSelected = displayChartType === value;
              return (
                <Button
                  key={value}
                  variant="outline"
                  onClick={() => handleChartTypeChange(value)}
                  style={{
                    backgroundColor: isSelected ? "var(--violet-5)" : undefined,
                    borderColor: isSelected ? "var(--violet-8)" : undefined,
                    color: isSelected ? "var(--violet-11)" : undefined,
                  }}
                >
                  {label}
                </Button>
              );
            })}
          </Grid>
        </Flex>
      </Box>
    </Collapsible>
  );
}
