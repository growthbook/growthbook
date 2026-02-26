import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import { PiChartBar, PiCode, PiDatabase, PiTable } from "react-icons/pi";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

export default function EmptyState() {
  const { permissionsUtil } = useUser();
  const { datasources } = useDefinitions();
  const { project } = useDefinitions();

  const hasDatasources = datasources.length > 0;

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
          Create powerful visualizations & custom dashboards built on your
          Metrics, Fact Tables, and Data Sources
        </Text>

        <Flex direction="column" gap="3">
          {!hasDatasources && (
            <Callout status="warning">
              Before you can explore your data, you&apos;ll need to{" "}
              <Link href="/datasources">connect a Data Source.</Link>
            </Callout>
          )}
          <Flex gap="3" mt="3">
            <LinkButton
              href="/product-analytics/explore/metrics"
              variant="outline"
              disabled={
                // If the user can't run metrics for the current project, or globally, don't show enable the button
                (!permissionsUtil.canRunMetricQueries({
                  projects: [project],
                }) &&
                  !permissionsUtil.canRunMetricQueries({ projects: [] })) ||
                !hasDatasources
              }
              style={{
                height: "116px",
                paddingTop: "16px",
                paddingBottom: "16px",
                width: "160px",
              }}
            >
              <Flex direction="column" align="center" gap="1">
                <PiChartBar size={24} />
                <Text weight="medium">Metrics</Text>
              </Flex>
            </LinkButton>
            <LinkButton
              href="/product-analytics/explore/fact-table"
              variant="outline"
              disabled={
                // If the user can't run fact queries for the current project, or globally, don't show enable the button
                (!permissionsUtil.canRunFactQueries({ projects: [project] }) &&
                  !permissionsUtil.canRunFactQueries({ projects: [] })) ||
                !hasDatasources
              }
              style={{
                height: "116px",
                paddingTop: "16px",
                paddingBottom: "16px",
                width: "160px",
              }}
            >
              <Flex direction="column" align="center" gap="1">
                <PiTable size={24} />
                <Text weight="medium">Fact Table</Text>
              </Flex>
            </LinkButton>
            <LinkButton
              href="/product-analytics/explore/data-source"
              variant="outline"
              disabled={
                // If the user can't run fact queries for the current project, or globally, don't show enable the button
                (!permissionsUtil.canRunFactQueries({ projects: [project] }) &&
                  !!permissionsUtil.canRunFactQueries({ projects: [] })) ||
                !hasDatasources
              }
              style={{
                height: "116px",
                paddingTop: "16px",
                paddingBottom: "16px",
                width: "160px",
              }}
            >
              <Flex direction="column" align="center" gap="1">
                <PiDatabase size={24} />
                <Text weight="medium">Data Source</Text>
              </Flex>
            </LinkButton>
            <LinkButton
              href="/sql-explorer"
              variant="outline"
              style={{
                height: "116px",
                paddingTop: "16px",
                paddingBottom: "16px",
                width: "160px",
              }}
              disabled={
                // If the user can't run custom SQL queries for the current project, or globally, don't show enable the button
                (!permissionsUtil.canRunFactQueries({
                  projects: [project],
                }) &&
                  !permissionsUtil.canRunFactQueries({ projects: [] })) ||
                !hasDatasources
              }
            >
              <Flex direction="column" align="center" gap="1">
                <PiCode size={24} />
                <Text weight="medium">Custom SQL</Text>
              </Flex>
            </LinkButton>
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );
}
