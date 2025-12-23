import { Box, Text, Flex } from "@radix-ui/themes";
import { DataVizConfig } from "shared/validators";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { PiPalette } from "react-icons/pi";
import Checkbox from "@/ui/Checkbox";

type Props = {
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
};

export default function DisplaySettingsPanel({
  dataVizConfig,
  onDataVizConfigChange,
}: Props) {
  const chartSupportsDisplaySettings =
    dataVizConfig.chartType === "bar" ||
    dataVizConfig.chartType === "line" ||
    dataVizConfig.chartType === "area" ||
    dataVizConfig.chartType === "scatter";

  if (!chartSupportsDisplaySettings) {
    return null;
  }

  return (
    <>
      <Flex
        direction="column"
        height="100%"
        style={{
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-4)",
          overflow: "hidden",
          backgroundColor: "var(--color-panel-translucent)",
        }}
      >
        <Collapsible
          open={true}
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
                    <PiPalette
                      style={{
                        color: "var(--violet-11)",
                      }}
                      size={20}
                    />
                    Display Settings
                  </Flex>
                  <Flex align="center" gap="1">
                    <FaAngleRight className="chevron" />
                  </Flex>
                </Flex>
              </Text>
            </div>
          }
          transitionTime={100}
        >
          <Box p="4" height="fit-content">
            <Flex direction="column" gap="4">
              <Checkbox
                label="Anchor chart to zero"
                value={
                  dataVizConfig.displaySettings?.disableAnchorToZero || true
                }
                setValue={() => {
                  onDataVizConfigChange({
                    ...dataVizConfig,
                    displaySettings: {
                      ...dataVizConfig.displaySettings,
                      disableAnchorToZero:
                        !dataVizConfig.displaySettings?.disableAnchorToZero,
                    },
                  });
                }}
              />
            </Flex>
          </Box>
        </Collapsible>
      </Flex>
    </>
  );
}
