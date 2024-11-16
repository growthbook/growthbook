import React from "react";
import { isProjectListValidForProject } from "shared/util";
import { Box, Tabs } from "@radix-ui/themes";
import MetricsList from "@/components/Metrics/MetricsList";
import MetricGroupsList from "@/components/Metrics/MetricGroupsList";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import LinkButton from "@/components/Radix/LinkButton";
import { NewMetricModal } from "@/components/FactTables/NewMetricModal";
import Button from "@/components/Radix/Button";

// 指标页面组件
const MetricsPage = (): React.ReactElement => {
  // 从定义上下文获取相关数据，包括指标、事实指标、数据源、项目等信息
  const { metrics, factMetrics, datasources, project } = useDefinitions();

  // 判断是否存在有效的数据源，即数据源的项目列表与当前项目匹配
  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project)
  );

  // 判断是否存在有效的指标，即指标的项目列表与当前项目匹配
  const hasMetrics =
    metrics.some((m) => isProjectListValidForProject(m.projects, project)) ||
    factMetrics.some((m) => isProjectListValidForProject(m.projects, project));

  // 控制新建指标模态框的显示状态
  const [showNewModal, setShowNewModal] = React.useState(false);

  return (
    <div className="container pagecontents">
      {showNewModal && (
        <NewMetricModal
          close={() => setShowNewModal(false)}
          source={"metrics-empty-state"}
        />
      )}
      <h1 className="mb-4">指标</h1>
      {!hasMetrics ? (
        <div className="appbox p-5 text-center">
          <h2>定义成功的标准</h2>
          <p>
            指标是通过在数据仓库之上使用SQL来定义的。在实验中将它们用作目标和保障措施以衡量成功与否。
          </p>
          <div className="mt-3">
            {!hasDatasource ? (
              <LinkButton href="/datasources">连接数据源</LinkButton>
            ) : (
              <Button onClick={() => setShowNewModal(true)}>添加指标</Button>
            )}
          </div>
        </div>
      ) : (
        <Tabs.Root defaultValue="metrics">
          <Tabs.List>
            <Tabs.Trigger value="metrics">单个指标</Tabs.Trigger>
            <Tabs.Trigger value="metricgroups">
              <PremiumTooltip commercialFeature="metric-groups">
                Metric Groups
              </PremiumTooltip>
            </Tabs.Trigger>
          </Tabs.List>
          <Box pt="4">
            <Tabs.Content value="metrics">
              <MetricsList />
            </Tabs.Content>

            <Tabs.Content value="metricgroups">
              <MetricGroupsList />
            </Tabs.Content>
          </Box>
        </Tabs.Root>
      )}
    </div>
  );
};

export default MetricsPage;
