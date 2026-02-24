import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import { BsFillBarChartLineFill } from "react-icons/bs";
import { PiDatabase, PiTable } from "react-icons/pi";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Heading from "@/ui/Heading";

export default function EmptyState() {
  const { changeDatasetType } = useExplorerContext();

  return (
    <Box m="7">
      <Heading as="h1" size="2x-large" weight="medium">
        Product Analytics
      </Heading>
      <Flex
        align="center"
        justify="center"
        direction="column"
        gap="3"
        mt="6"
        style={{
          minHeight: "400px",
          color: "var(--color-text-mid)",
          border: "2px dashed var(--gray-a3)",
          borderRadius: "var(--radius-4)",
        }}
      >
        <Heading as="h2" size="x-large" weight="medium">
          Select an Explorer Type
        </Heading>
        <Text color="text-low" align="center">
          Choose how you want to explore your data
        </Text>
        <Flex gap="3" mt="3">
          <Button
            variant="outline"
            style={{
              height: "116px",
              paddingTop: "16px",
              paddingBottom: "16px",
              width: "160px",
            }}
            onClick={() => changeDatasetType("metric")}
          >
            <Flex direction="column" align="center" gap="1">
              <BsFillBarChartLineFill size={24} />
              <Text weight="medium">Metrics</Text>
            </Flex>
          </Button>
          <Button
            variant="outline"
            style={{
              height: "116px",
              paddingTop: "16px",
              paddingBottom: "16px",
              width: "160px",
            }}
            onClick={() => changeDatasetType("fact_table")}
          >
            <Flex direction="column" align="center" gap="1">
              <PiTable size={24} />
              <Text weight="medium">Fact Table</Text>
            </Flex>
          </Button>
          <Button
            variant="outline"
            style={{
              height: "116px",
              paddingTop: "16px",
              paddingBottom: "16px",
              width: "160px",
            }}
            onClick={() => {
              changeDatasetType("data_source");
            }}
          >
            <Flex direction="column" align="center" gap="1">
              <PiDatabase size={24} />
              <Text weight="medium">Data Source</Text>
            </Flex>
          </Button>
        </Flex>
      </Flex>
    </Box>
  );
}
