import React, { FC, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { FaExclamationTriangle } from "react-icons/fa";
import { ago } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import { SchemaFormat } from "back-end/types/datasource";
import ProjectBadges from "@/components/ProjectBadges";
import { GBAddCircle } from "@/components/Icons";
import { DocLink } from "@/components/DocLink";
import { hasFileConfig } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/components/Button";
import DataSourceLogo from "@/components/DataSources/DataSourceLogo";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import NewDataSourceForm from "./NewDataSourceForm";

const DataSources: FC = () => {
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [useSetupEventTracker, setUseSetupEventTracker] = useState(false);
  const { organization } = useUser();
  const { apiCall } = useAuth();
  const { setupEventTracker } = organization;

  console.log({ setupEventTracker });

  const router = useRouter();

  const {
    datasources,
    project,
    error,
    mutateDefinitions,
    ready,
  } = useDefinitions();
  const filteredDatasources = project
    ? datasources.filter((ds) =>
        isProjectListValidForProject(ds.projects, project)
      )
    : datasources;

  const permissionsUtil = usePermissionsUtil();

  const {
    exists: demoDataSourceExists,
    currentProjectIsDemo,
  } = useDemoDataSourceProject();
  const buttonTitle = currentProjectIsDemo
    ? "You cannot create a datasource under the demo project"
    : "";

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }
  if (!ready) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      {filteredDatasources.length > 0 ? (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th className="col-2">Display Name</th>
              <th className="col-auto">Description</th>
              <th className="col-2">Type</th>
              <th className="col-2">Projects</th>
              {!hasFileConfig() && <th className="col-2">Last Updated</th>}
            </tr>
          </thead>
          <tbody>
            {filteredDatasources.map((d, i) => (
              <tr
                className="nav-item"
                key={i}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(`/datasources/${d.id}`);
                }}
              >
                <td>
                  <Link href={`/datasources/${d.id}`}>{d.name}</Link>{" "}
                  {d.decryptionError && (
                    <Tooltip
                      body={
                        <>
                          Could not decrypt the connection settings for this
                          data source. Click on the data source name for more
                          info.
                        </>
                      }
                    >
                      <FaExclamationTriangle className="text-danger" />
                    </Tooltip>
                  )}
                </td>
                <td className="pr-5 text-gray" style={{ fontSize: 12 }}>
                  {d.description}
                </td>
                <td>{d.type}</td>
                <td>
                  {(d?.projects?.length || 0) > 0 ? (
                    <ProjectBadges
                      resourceType="data source"
                      projectIds={d.projects}
                      className="badge-ellipsis short align-middle"
                    />
                  ) : (
                    <ProjectBadges
                      resourceType="data source"
                      className="badge-ellipsis short align-middle"
                    />
                  )}
                </td>
                {/* @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'Date | null' is not assignable t... Remove this comment to see the full error message */}
                {!hasFileConfig() && <td>{ago(d.dateUpdated)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="appbox py-5 px-5 text-center mt-4">
          {setupEventTracker &&
          permissionsUtil.canViewCreateDataSourceModal(project) &&
          !hasFileConfig() ? (
            <>
              <div className="mx-5">
                <h1>Automatically Fetch Experiment Results & Metric Values</h1>
                <h4 className="font-weight-normal mx-5">
                  Securely connect your data source to analyze experiment
                  results from within GrowthBook. We use multiple layers of
                  encryption, and no Personally Identifiable Information (PII)
                  ever hits our servers.
                </h4>
              </div>

              <h4 className="mt-5">Connect your Data Source to GrowthBook</h4>
              <div
                className="border rounded d-inline-flex mt-3"
                style={{
                  height: 50,
                  padding: 10,
                }}
              >
                <DataSourceLogo
                  eventTracker={setupEventTracker as SchemaFormat}
                  showLabel
                />
              </div>
              <div className="col mt-4">
                <div className="row justify-content-center">
                  <Button
                    onClick={() => {
                      setUseSetupEventTracker(true);
                      setNewModalOpen(true);
                    }}
                  >
                    Complete Connection
                  </Button>
                </div>
                <div className="row justify-content-center mt-3">
                  <button
                    className="btn btn-link"
                    onClick={() => setNewModalOpen(true)}
                  >
                    Change selections
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p>
                Connect GrowthBook to your data so we can automatically fetch
                experiment results and metric values. We currently support{" "}
                <strong>Redshift</strong>, <strong>Snowflake</strong>,{" "}
                <strong>BigQuery</strong>, <strong>ClickHouse</strong>,{" "}
                <strong>Postgres</strong>, <strong>MySQL</strong>,{" "}
                <strong>MS SQL/SQL Server</strong>, <strong>Athena</strong>,{" "}
                <strong>PrestoDB</strong>, <strong>Databricks</strong>,{" "}
                <strong>Mixpanel</strong>, and <strong>Google Analytics</strong>{" "}
                with more coming soon.
              </p>
              <p>
                We only ever fetch aggregate data, so none of your user&apos;s
                Personally Identifiable Information ever hits our servers. Plus,
                we use multiple layers of encryption to store your credentials
                and require minimal read-only permissions, so you can be sure
                your source data remains secure.
              </p>
              {!demoDataSourceExists && !currentProjectIsDemo && (
                <>
                  <p>
                    You can also create a{" "}
                    <Link href="/demo-datasource-project" className="info">
                      demo datasource project
                    </Link>
                    .
                  </p>
                </>
              )}
              {hasFileConfig() && (
                <div className="alert alert-info">
                  It looks like you have a <code>config.yml</code> file. Data
                  sources defined there will show up on this page.{" "}
                  <DocLink docSection="config_yml">View Documentation</DocLink>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!hasFileConfig() &&
        !setupEventTracker &&
        permissionsUtil.canViewCreateDataSourceModal(project) && (
          <button
            className="btn btn-primary"
            disabled={currentProjectIsDemo}
            title={buttonTitle}
            onClick={(e) => {
              e.preventDefault();
              setNewModalOpen(true);
            }}
          >
            <span className="h4 pr-2 m-0 d-inline-block align-top">
              <GBAddCircle />
            </span>
            Add Data Source
          </button>
        )}

      {newModalOpen && (
        <NewDataSourceForm
          existing={false}
          data={{
            name: "My Datasource",
            settings:
              useSetupEventTracker && setupEventTracker
                ? { schemaFormat: setupEventTracker as SchemaFormat }
                : {},
            projects: project ? [project] : [],
          }}
          source="datasource-list"
          onSuccess={async (id) => {
            await mutateDefinitions({});
            setNewModalOpen(false);
            await apiCall(`/organization/setup-event-tracker`, {
              method: "PUT",
              body: JSON.stringify({
                eventTracker: "",
              }),
            });
            await router.push(`/datasources/${id}`);
          }}
          onCancel={() => {
            setNewModalOpen(false);
            setUseSetupEventTracker(false);
          }}
          showImportSampleData={!demoDataSourceExists}
        />
      )}
    </div>
  );
};

export default DataSources;
