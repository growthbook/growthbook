import React from "react";
import { Flex, Text, Box } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { FactTableInterface } from "back-end/types/fact-table";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { PiPalette } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import SeriesList from "./SeriesList";

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
  factTable: FactTableInterface | null;
}

export default function MetricExplorerDisplaySettings({
  block,
  setBlock,
  factTable,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");

  return (
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
              <Flex justify="between" align="center" mb="1" mt="1">
                <Flex align="center" gap="1">
                  <PiPalette
                    style={{
                      color: "var(--violet-11)",
                    }}
                    size={20}
                  />
                  Display Settings
                </Flex>
                <FaAngleRight className="chevron" />
              </Flex>
            </Text>
          </div>
        }
        transitionTime={100}
      >
        <Box p="4" height="fit-content">
          <Flex direction="column" gap="4">
            <SeriesList
              block={block}
              setBlock={setBlock}
              factTable={factTable}
              hasMetricSlicesFeature={hasMetricSlicesFeature}
            />
          </Flex>
        </Box>
      </Collapsible>
    </Flex>
  );
}
