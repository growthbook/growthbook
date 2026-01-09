import React from "react";
import Collapsible from "react-collapsible";
import { Box, Flex, Separator, Text, TextField } from "@radix-ui/themes";
import { PiNetwork, PiTrash } from "react-icons/pi";
import { FaAngleRight, FaPlusCircle } from "react-icons/fa";
import { DataVizConfig, dimensionAxisConfiguration } from "shared/validators";
import { Select, SelectItem } from "@/ui/Select";
import { supportsDimension } from "@/services/dataVizTypeGuards";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";

export default function DataVizDimensionPanel({
  dataVizConfig,
  onDataVizConfigChange,
  axisKeys,
  label = "Dimension",
}: {
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
  axisKeys: string[];
  label?: string;
}) {
  if (!supportsDimension(dataVizConfig)) {
    return null;
  }

  const dimensions: dimensionAxisConfiguration[] =
    dataVizConfig.dimension || [];

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
                    {label === "Dimension" ? (
                      <PiNetwork
                        style={{
                          color: "var(--violet-11)",
                          transform: "rotate(-90deg)",
                        }}
                        size={20}
                      />
                    ) : null}
                    {label}s
                    <Badge
                      label={dimensions.length.toString()}
                      color="violet"
                      radius="full"
                      variant="soft"
                    />
                  </Flex>
                  <Flex align="center" gap="1">
                    <Button
                      variant="ghost"
                      color="red"
                      disabled={dimensions.length === 0}
                      onClick={() => {
                        onDataVizConfigChange({
                          ...dataVizConfig,
                          dimension: undefined,
                        });
                      }}
                    >
                      Clear
                    </Button>
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
              {dimensions.length ? (
                <>
                  {dimensions.map((dimension, index) => {
                    return (
                      <React.Fragment key={index}>
                        {index > 0 && <Separator size="4" mt="2" />}
                        <Select
                          label={
                            <Flex justify="between" align="center">
                              <Text as="label">
                                {label} {index + 1}
                              </Text>
                              <Box mb="2">
                                <Button
                                  variant="ghost"
                                  color="red"
                                  onClick={() => {
                                    onDataVizConfigChange({
                                      ...dataVizConfig,
                                      dimension: undefined,
                                    });
                                  }}
                                >
                                  <PiTrash />
                                </Button>
                              </Box>
                            </Flex>
                          }
                          value={dimension.fieldName ?? ""}
                          setValue={(v) => {
                            const isBarOrArea =
                              dataVizConfig.chartType === "bar" ||
                              dataVizConfig.chartType === "area";
                            const display: "grouped" | "stacked" = isBarOrArea
                              ? supportsDimension(dataVizConfig) &&
                                dataVizConfig.dimension?.[0]?.display
                                ? dataVizConfig.dimension[0].display
                                : "grouped"
                              : "grouped";
                            onDataVizConfigChange({
                              ...dataVizConfig,
                              dimension: [
                                {
                                  fieldName: v,
                                  display,
                                  maxValues: dimension.maxValues || 5,
                                },
                              ],
                            } as Partial<DataVizConfig>);
                          }}
                          size="2"
                          placeholder="Select a dimension"
                        >
                          {axisKeys.map((key) => (
                            <SelectItem key={key} value={key}>
                              {key}
                            </SelectItem>
                          ))}
                        </Select>
                        {dimension.fieldName && (
                          <>
                            <Flex direction="column" gap="2">
                              {(dataVizConfig.chartType === "bar" ||
                                dataVizConfig.chartType === "area") && (
                                <Flex
                                  direction="row"
                                  justify="between"
                                  align="center"
                                >
                                  <Text
                                    as="label"
                                    size="2"
                                    mr="2"
                                    style={{ flex: 1 }}
                                  >
                                    Display
                                  </Text>
                                  <Select
                                    style={{ flex: 1 }}
                                    value={dimension.display}
                                    setValue={(v) => {
                                      if (
                                        !supportsDimension(dataVizConfig) ||
                                        !dataVizConfig.dimension
                                      )
                                        return;
                                      // If we want to support multiple dimensions, we'll need to update the code below
                                      // Not doing now so we don't overengineer it.
                                      onDataVizConfigChange({
                                        ...dataVizConfig,
                                        dimension: [
                                          {
                                            ...dimension,
                                            display: v as "grouped" | "stacked",
                                          },
                                        ],
                                      });
                                    }}
                                    size="2"
                                  >
                                    <SelectItem value="grouped">
                                      Grouped
                                    </SelectItem>
                                    <SelectItem value="stacked">
                                      Stacked
                                    </SelectItem>
                                  </Select>
                                </Flex>
                              )}
                              <Flex
                                direction="row"
                                justify="between"
                                align="center"
                              >
                                <Text
                                  as="label"
                                  size="2"
                                  mr="2"
                                  style={{ flex: 1 }}
                                >
                                  Max Values
                                </Text>
                                <TextField.Root
                                  style={{ flex: 1 }}
                                  size="2"
                                  min="1"
                                  max="10"
                                  step="1"
                                  type="number"
                                  value={dimension.maxValues?.toString() || "5"}
                                  onChange={(e) => {
                                    const maxValues = parseInt(
                                      e.target.value,
                                      10,
                                    );
                                    if (
                                      !supportsDimension(dataVizConfig) ||
                                      !dataVizConfig.dimension
                                    )
                                      return;
                                    onDataVizConfigChange({
                                      ...dataVizConfig,
                                      dimension: [
                                        {
                                          ...dimension,
                                          maxValues,
                                        },
                                      ],
                                    } as Partial<DataVizConfig>);
                                  }}
                                />
                              </Flex>
                            </Flex>
                          </>
                        )}
                      </React.Fragment>
                    );
                  })}
                </>
              ) : null}
              {/* Currently, we only support 1 dimension, but this might change down the road. So only showing the Add CTA if there are no dimensions */}
              {!dimensions.length ? (
                <a
                  role="button"
                  className="d-inline-block link-purple font-weight-bold"
                  onClick={() => {
                    onDataVizConfigChange({
                      ...dataVizConfig,
                      dimension: [
                        {
                          fieldName: axisKeys[0],
                          display: "grouped",
                          maxValues: 5,
                        },
                      ],
                    });
                  }}
                >
                  <FaPlusCircle className="mr-1" />
                  Add {label}
                </a>
              ) : null}
            </Flex>
          </Box>
        </Collapsible>
      </Flex>
    </>
  );
}
