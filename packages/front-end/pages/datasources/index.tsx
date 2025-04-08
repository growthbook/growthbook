import { FC, useState } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { isProjectListValidForProject } from "shared/util";
import { useRouter } from "next/router";
import { DocLink } from "@/components/DocLink";
import DataSources from "@/components/Settings/DataSources";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/components/Radix/Button";
import { hasFileConfig } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/components/Radix/Callout";
import { dataSourceConnections } from "@/services/eventSchema";
import NewDataSourceForm from "@/components/Settings/NewDataSourceForm";
import LinkButton from "@/components/Radix/LinkButton";
import DataSourceDiagram from "@/components/InitialSetup/DataSourceDiagram";
import DataSourceTypeSelector from "@/components/Settings/DataSourceTypeSelector";

const DataSourcesPage: FC = () => {
  const {
    exists: demoDataSourceExists,
    projectId: demoProjectId,
    demoDataSourceId,
    currentProjectIsDemo,
  } = useDemoDataSourceProject();
  const { apiCall } = useAuth();
  const {
    mutateDefinitions,
    setProject,
    project,
    datasources,
  } = useDefinitions();

  const router = useRouter();

  const filteredDatasources = (project
    ? datasources.filter((ds) =>
      isProjectListValidForProject(ds.projects, project)
    )
    : datasources
  ).filter((ds) => !ds.projects?.includes(demoProjectId || ""));

  const [
    newModalData,
    setNewModalData,
  ] = useState<null | Partial<DataSourceInterfaceWithParams>>(null);

  const permissionsUtil = usePermissionsUtil();

  return (
    <div className="container-fluid pagecontents">
      {newModalData && (
        <NewDataSourceForm
          initial={newModalData || undefined}
          source="datasource-list"
          onSuccess={async (id) => {
            await mutateDefinitions({});
            await router.push(`/datasources/${id}`);
          }}
          onCancel={() => {
            setNewModalData(null);
          }}
          showImportSampleData={false}
        />
      )}
      <div className="d-flex align-items-center mb-3">
        <h1>数据源</h1>
        <div className="ml-auto" />
        {!hasFileConfig() && !demoDataSourceExists && (
          <Button
            onClick={async () => {
              try {
                await apiCall("/demo-datasource-project", {
                  method: "POST",
                });
                track("创建示例项目", {
                  source: "sample-project-page",
                });
                if (demoProjectId) {
                  setProject(demoProjectId);
                }
                await mutateDefinitions();
              } catch (e: unknown) {
                console.error(e);
              }
            }}
            variant="soft"
          >
            查看示例数据源
          </Button>
        )}
        {demoDataSourceExists && demoProjectId && demoDataSourceId ? (
          <LinkButton href={`/datasources/${demoDataSourceId}`} variant="soft">
            查看示例数据源
          </LinkButton>
        ) : null}
        {!hasFileConfig() &&
          permissionsUtil.canViewCreateDataSourceModal(project) && (
            <Button
              disabled={currentProjectIsDemo}
              title={
                currentProjectIsDemo
                  ? "您无法在演示项目下创建数据源"
                  : ""
              }
              onClick={() => setNewModalData({})}
              ml="2"
            >
              添加数据源
            </Button>
          )}
      </div>
      {filteredDatasources.length > 0 ? (
        <DataSources />
      ) : (
        <div className="bg-white p-5 mb-3">
          <div className="text-center mt-3">
            <h2 className="h1 mb-2">
              自动获取实验结果和指标值
            </h2>
            <p className="mb-4">
              GrowthBook是原生仓库型的，这意味着我们基于您现有的数据，而不是存储我们自己的数据副本。
              <br />
              这种方式更经济、更安全、更灵活。
            </p>
          </div>
          <hr className="my-4" />
          <div className="mb-3 d-flex flex-column align-items-center justify-content-center w-100">
            <div className="mb-3">
              <h3>您将分析数据存储在哪里？请选择一项：</h3>
            </div>

            <DataSourceTypeSelector
              value=""
              setValue={(value) => {
                const option = dataSourceConnections.find(
                  (o) => o.type === value
                );
                if (!option) return;

                setNewModalData({
                  type: option.type,
                  params: option.default,
                } as Partial<DataSourceInterfaceWithParams>);

                track("数据源类型已选择", {
                  type: value,
                  newDatasourceForm: true,
                });
              }}
            />

            {/* <Callout status="info" mt="5">
              还没有数据仓库吗？我们推荐使用带有Google Analytics的Google BigQuery。{" "}
              <DocLink docSection="ga4BigQuery">
                了解更多 <FaExternalLinkAlt />
              </DocLink>
            </Callout> */}
          </div>
          <hr className="my-5" />
          <div className="d-flex align-items-center justify-content-center w-100">
            <DataSourceDiagram />
          </div>
        </div>
      )}
    </div>
  );
};
export default DataSourcesPage;