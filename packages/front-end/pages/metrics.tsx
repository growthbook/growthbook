import React from "react";
import { isProjectListValidForProject } from "shared/util";
import { Box } from "@radix-ui/themes";
import MetricsList from "@/components/Metrics/MetricsList";
import MetricGroupsList from "@/components/Metrics/MetricGroupsList";
import { useDefinitions } from "@/services/DefinitionsContext";
import LinkButton from "@/ui/LinkButton";
import useFactMetricFlow from "@/hooks/useFactMetricFlow";
import { Tabs, TabsTrigger, TabsList, TabsContent } from "@/ui/Tabs";
import MetricTemplateRedirect from "@/components/FactTables/MetricTemplateRedirect";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";

const MetricsPage = (): React.ReactElement => {
  const { metrics, factMetrics, datasources, project } = useDefinitions();

  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project),
  );
  const hasMetrics =
    metrics.some((m) => isProjectListValidForProject(m.projects, project)) ||
    factMetrics.some((m) => isProjectListValidForProject(m.projects, project));

  const factMetricFlow = useFactMetricFlow("metrics-empty-state");

  return (
    <Box className="pagecontents container-fluid">
      {factMetricFlow.modal}
      <MetricTemplateRedirect />
      <Box mb="4">
        <h1 style={{ margin: 0 }}>Metrics</h1>
      </Box>
      {!hasMetrics ? (
        <Box className="appbox" p="5" style={{ textAlign: "center" }}>
          <h2>Define What Success Looks Like</h2>
          <p>
            Metrics are defined with SQL on top of your data warehouse. Use them
            as goals and guardrails in experiments to measure success.
            {hasDatasource &&
              factMetricFlow.creation().mode === "fact-table" &&
              " A fact table provides the shared SQL query for your Fact Metrics."}
          </p>
          <Box mt="3">
            {!hasDatasource ? (
              <LinkButton href="/datasources">Connect Data Source</LinkButton>
            ) : (
              factMetricFlow.createButton()
            )}
          </Box>
        </Box>
      ) : (
        <Tabs defaultValue="metrics" persistInURL={true}>
          <TabsList>
            <TabsTrigger value="metrics">Individual Metrics</TabsTrigger>
            <TabsTrigger value="metricgroups">
              Metric Groups{" "}
              <PaidFeatureBadge commercialFeature="metric-groups" mx="2" />
            </TabsTrigger>
          </TabsList>
          <Box pt="4">
            <TabsContent value="metrics">
              <MetricsList />
            </TabsContent>

            <TabsContent value="metricgroups">
              <MetricGroupsList />
            </TabsContent>
          </Box>
        </Tabs>
      )}
    </Box>
  );
};

export default MetricsPage;
