import React from "react";
import { isProjectListValidForProject } from "shared/util";
import { Box } from "@radix-ui/themes";
import MetricsList from "@/components/Metrics/MetricsList";
import MetricGroupsList from "@/components/Metrics/MetricGroupsList";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import LinkButton from "@/components/Radix/LinkButton";
import { NewMetricModal } from "@/components/FactTables/NewMetricModal";
import Button from "@/components/Radix/Button";
import {
  Tabs,
  TabsTrigger,
  TabsList,
  TabsContent,
} from "@/components/Radix/Tabs";

const MetricsPage = (): React.ReactElement => {
  const { metrics, factMetrics, datasources, project } = useDefinitions();

  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project)
  );
  const hasMetrics =
    metrics.some((m) => isProjectListValidForProject(m.projects, project)) ||
    factMetrics.some((m) => isProjectListValidForProject(m.projects, project));

  const [showNewModal, setShowNewModal] = React.useState(false);

  return (
    <div className="container pagecontents">
      {showNewModal && (
        <NewMetricModal
          close={() => setShowNewModal(false)}
          source={"metrics-empty-state"}
        />
      )}
      <h1 className="mb-4">Metrics</h1>
      {!hasMetrics ? (
        <div className="appbox p-5 text-center">
          <h2>Define What Success Looks Like</h2>
          <p>
            Metrics are defined with SQL on top of your data warehouse. Use them
            as goals and guardrails in experiments to measure success.
          </p>
          <div className="mt-3">
            {!hasDatasource ? (
              <LinkButton href="/datasources">Connect Data Source</LinkButton>
            ) : (
              <Button onClick={() => setShowNewModal(true)}>Add Metric</Button>
            )}
          </div>
        </div>
      ) : (
        <Tabs defaultValue="metrics">
          <TabsList>
            <TabsTrigger value="metrics">Individual Metrics</TabsTrigger>
            <TabsTrigger value="metricgroups">
              <PremiumTooltip commercialFeature="metric-groups">
                Metric Groups
              </PremiumTooltip>
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
    </div>
  );
};

export default MetricsPage;
