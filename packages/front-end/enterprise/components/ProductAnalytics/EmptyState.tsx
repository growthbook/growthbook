import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import { useExplorerContext } from "./ExplorerContext";
import { Text } from "@radix-ui/themes";
import { BsFillBarChartLineFill, BsGraphUpArrow } from "react-icons/bs";
import Button from "@/ui/Button";
import { PiCode, PiTable } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";


export default function EmptyState() {

    const { changeDatasetType, setDraftExploreState } = useExplorerContext();
    const { datasources } = useDefinitions();
    
    return (
      <Box m="7">
        <Text size="7" weight="medium">Product Analytics</Text>
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
            <Text size="6" weight="medium">
              Select an Explorer Type
            </Text>
            <Text
              size="2"
              style={{ maxWidth: 350, textAlign: "center" }}
              className="text-muted"
            >
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
                  <Text size="2" weight="medium">
                    Metrics
                  </Text>
                  <Text size="1" className="text-muted">
                    Pre-built metrics
                  </Text>
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
                  <Text size="2" weight="medium">
                    Fact Table
                  </Text>
                  <Text size="1" className="text-muted">
                    Build custom queries
                  </Text>
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
                  changeDatasetType("database");
                  if (datasources.length > 0) {
                    setDraftExploreState((prev) => ({
                      ...prev,
                      dataset: { ...prev.dataset, datasource: datasources[0].id },
                    }));
                  }
                }}
              >
                <Flex direction="column" align="center" gap="1">
                  <PiCode size={24} />
                  <Text size="2" weight="medium">
                    Database
                  </Text>
                  <Text size="1" className="text-muted">
                    Explore a table in your database
                  </Text>
                </Flex>
              </Button>
            </Flex>
          </Flex>
      </Box>
    );
  }