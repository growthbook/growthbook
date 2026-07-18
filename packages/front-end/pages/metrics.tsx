import React from "react";
import { isProjectListValidForProject } from "shared/util";
import { Box } from "@radix-ui/themes";
import MetricsList from "@/components/Metrics/MetricsList";
import MetricGroupsList from "@/components/Metrics/MetricGroupsList";
import { useDefinitions } from "@/services/DefinitionsContext";
import LinkButton from "@/ui/LinkButton";
import { NewMetricModal } from "@/components/FactTables/NewMetricModal";
import Button from "@/ui/Button";
import { Tabs, TabsTrigger, TabsList, TabsContent } from "@/ui/Tabs";
import Tooltip from "@/components/Tooltip/Tooltip";
import CreateMetricFromTemplate from "@/components/FactTables/CreateMetricFromTemplate";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const MetricsPage = (): React.ReactElement => {
  const { metrics, factMetrics, factTables, datasources, project } =
    useDefinitions();

  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project),
  );
  const hasMetrics =
    metrics.some((m) => isProjectListValidForProject(m.projects, project)) ||
    factMetrics.some((m) => isProjectListValidForProject(m.projects, project));

  const hasFactTables = factTables.some((f) =>
    isProjectListValidForProject(f.projects, project),
  );

  const permissionsUtil = usePermissionsUtil();
  const canCreateMetric = permissionsUtil.canCreateMetric({
    projects: [project],
  });

  const [showNewModal, setShowNewModal] = React.useState(false);

  return (
    <Box className="pagecontents container-fluid">
      {showNewModal && (
        <NewMetricModal
          close={() => setShowNewModal(false)}
          source={"metrics-empty-state"}
        />
      )}
      <CreateMetricFromTemplate />
      <Box mb="4">
        <h1 style={{ margin: 0 }}>Metrics</h1>
      </Box>
      {!hasMetrics ? (
        <Box className="appbox" p="5" style={{ textAlign: "center" }}>
          <h2>Define What Success Looks Like</h2>
          <p>
            Metrics are defined with SQL on top of your data warehouse. Use them
            as goals and guardrails in experiments to measure success.
          </p>
          <Box mt="3">
            {!hasDatasource ? (
              <LinkButton href="/datasources">Connect Data Source</LinkButton>
            ) : !hasFactTables ? (
              <>
                <p>
                  Start by creating a <strong>Fact Table</strong>, which serves
                  as the foundation for your metrics.
                </p>
                <LinkButton href="/fact-tables">Create Fact Table</LinkButton>
              </>
            ) : (
              <Tooltip
                body="You don't have permission to add metrics in this project."
                shouldDisplay={!canCreateMetric}
              >
                <Button
                  disabled={!canCreateMetric}
                  onClick={() => setShowNewModal(true)}
                >
                  Add Metric
                </Button>
              </Tooltip>
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
