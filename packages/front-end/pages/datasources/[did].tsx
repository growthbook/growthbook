import { useRouter } from "next/router";
import React, { FC, useCallback, useState } from "react";
import {
  FaDatabase,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaKey,
} from "react-icons/fa";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import { DocLink, DocSection } from "@/components/DocLink";
import { DataSourceInlineEditIdentifierTypes } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentifierTypes/DataSourceInlineEditIdentifierTypes";
import { DataSourceInlineEditIdentityJoins } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentityJoins/DataSourceInlineEditIdentityJoins";
import { ExperimentAssignmentQueries } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/ExperimentAssignmentQueries";
import { DataSourceViewEditExperimentProperties } from "@/components/Settings/EditDataSource/DataSourceExperimentProperties/DataSourceViewEditExperimentProperties";
import { DataSourceJupyterNotebookQuery } from "@/components/Settings/EditDataSource/DataSourceJupypterQuery/DataSourceJupyterNotebookQuery";
import { checkDatasourceProjectPermissions } from "@/services/datasources";
import ProjectBadges from "@/components/ProjectBadges";
import usePermissions from "@/hooks/usePermissions";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import DataSourceForm from "@/components/Settings/DataSourceForm";
import Code from "@/components/SyntaxHighlighting/Code";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/components/Modal";
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import DataSourceMetrics from "@/components/Settings/EditDataSource/DataSourceMetrics";
import DataSourcePipeline from "@/components/Settings/EditDataSource/DataSourcePipeline/DataSourcePipeline";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";

function quotePropertyName(name: string) {
  if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
    return name;
  }
  return JSON.stringify(name);
}

const DataSourcePage: FC = () => {
  const permissions = usePermissions();
  const [editConn, setEditConn] = useState(false);
  const [viewSchema, setViewSchema] = useState(false);
  const router = useRouter();

  const {
    getDatasourceById,
    mutateDefinitions,
    ready,
    error,
  } = useDefinitions();
  const { did } = router.query as { did: string };
  const d = getDatasourceById(did);
  const { apiCall } = useAuth();
  const { organization, hasCommercialFeature } = useUser();

  const canEdit =
    (d &&
      checkDatasourceProjectPermissions(d, permissions, "createDatasources") &&
      !hasFileConfig()) ||
    false;

  const pipelineEnabled =
    useFeatureIsOn("datasource-pipeline-mode") &&
    hasCommercialFeature("pipeline-mode");

  /**
   * Update the data source provided.
   * Each section is responsible for retaining the rest of the data source and editing its specific section.
   */
  const updateDataSourceSettings = useCallback(
    async (dataSource: DataSourceInterfaceWithParams) => {
      const updates = {
        settings: dataSource.settings,
      };
      await apiCall(`/datasource/${dataSource.id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      const queriesUpdated =
        d &&
        JSON.stringify(d.settings?.queries) !==
          JSON.stringify(dataSource.settings?.queries);
      if (queriesUpdated) {
        apiCall<{ id: string }>("/experiments/import", {
          method: "POST",
          body: JSON.stringify({
            datasource: dataSource.id,
            force: true,
          }),
        });
      }
      await mutateDefinitions({});
    },
    [mutateDefinitions, apiCall, d]
  );

  if (error) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }
  if (!ready) {
    return <LoadingOverlay />;
  }
  if (!d) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          Datasource <code>{did}</code> does not exist.
        </div>
      </div>
    );
  }

  const supportsSQL = d.properties?.queryLanguage === "sql";
  const supportsEvents = d.properties?.events || false;

  return (
    <div className="container pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Data Sources", href: "/datasources" },
          { display: d.name },
        ]}
      />

      {d.projects?.includes(
        getDemoDatasourceProjectIdForOrganization(organization.id)
      ) && (
        <div className="alert alert-info mb-3 d-flex align-items-center mt-3">
          <div className="flex-1">
            This is part of our sample dataset. You can safely delete this once
            you are done exploring.
          </div>
          <div style={{ width: 180 }} className="ml-2">
            <DeleteDemoDatasourceButton
              onDelete={() => router.push("/datasources")}
              source="datasource"
            />
          </div>
        </div>
      )}

      {d.decryptionError && (
        <div className="alert alert-danger mb-2 d-flex justify-content-between align-items-center">
          <strong>Error Decrypting Data Source Credentials.</strong>{" "}
          <DocLink docSection="env_prod" className="btn btn-primary">
            View instructions for fixing
          </DocLink>
        </div>
      )}
      <div className="row mb-2 align-items-center">
        <div className="col-auto">
          <h1 className="mb-0">{d.name}</h1>
        </div>
        <div className="col-auto">
          <span className="badge badge-secondary">{d.type.toString()}</span>{" "}
          <span className="badge badge-success">connected</span>{" "}
          {organization.settings?.defaultDataSource == d.id && (
            <span className="badge badge-info">default</span>
          )}
        </div>
      </div>
      <div className="row mt-1 mb-3 align-items-center">
        <div className="col-auto">
          <div className="text-gray">{d.description}</div>
        </div>
      </div>
      <div className="row mb-3 align-items-center">
        <div className="col">
          Projects:{" "}
          {d?.projects?.length || 0 > 0 ? (
            <ProjectBadges
              projectIds={d.projects}
              className="badge-ellipsis align-middle"
            />
          ) : (
            <ProjectBadges className="badge-ellipsis align-middle" />
          )}
        </div>
      </div>

      <div className="row">
        <div className="col-md-12">
          <div className="mb-3">
            {canEdit && (
              <div className="d-md-flex w-100 justify-content-between">
                <div>
                  <button
                    className="btn btn-outline-primary mr-2 mt-1 font-weight-bold"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditConn(true);
                    }}
                  >
                    <FaKey /> Edit Connection Info
                  </button>

                  <DocLink
                    className="btn btn-outline-secondary mr-2 mt-1 font-weight-bold"
                    docSection={d.type as DocSection}
                    fallBackSection="datasources"
                  >
                    <FaExternalLinkAlt /> View Documentation
                  </DocLink>
                  {d?.properties?.supportsInformationSchema && (
                    <button
                      className="btn btn-outline-info mr-2 mt-1 font-weight-bold"
                      onClick={(e) => {
                        e.preventDefault();
                        setViewSchema(true);
                      }}
                    >
                      <FaDatabase /> View Schema Browser
                    </button>
                  )}
                </div>

                <div>
                  {canEdit && (
                    <DeleteButton
                      displayName={d.name}
                      className="font-weight-bold mt-1"
                      text={`Delete "${d.name}" Datasource`}
                      onClick={async () => {
                        await apiCall(`/datasource/${d.id}`, {
                          method: "DELETE",
                        });
                        mutateDefinitions({});
                        router.push("/datasources");
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
          {!d.properties?.hasSettings && (
            <div className="alert alert-info">
              This data source does not require any additional configuration.
            </div>
          )}
          {supportsEvents && (
            <>
              <div className="my-5">
                <DataSourceViewEditExperimentProperties
                  dataSource={d}
                  onSave={updateDataSourceSettings}
                  onCancel={() => undefined}
                  canEdit={canEdit}
                />
              </div>

              {d.type === "mixpanel" && (
                <div>
                  <h3>Mixpanel Tracking Instructions</h3>
                  <p>
                    This example is for Javascript and uses the above settings.
                    Other languages should be similar.
                  </p>
                  <Code
                    language="javascript"
                    code={`
// Tracking Callback for GrowthBook SDK
const growthbook = new GrowthBook({
  ...,
  trackingCallback: function(experiment, result) {
    mixpanel.track(${JSON.stringify(
      d.settings?.events?.experimentEvent || "$experiment_started"
    )}, {
      ${quotePropertyName(
        d.settings?.events?.experimentIdProperty || "Experiment name"
      )}: experiment.key,
      ${quotePropertyName(
        d.settings?.events?.variationIdProperty || "Variant name"
      )}:  result.variationId,
      $source: 'growthbook'
    })
  }
})

// When Mixpanel loads, pass the distinct_id into the SDK
mixpanel.init('YOUR PROJECT TOKEN', {
  loaded: function(mixpanel) {
    growthbook.setAttributes({
      ...growthbook.getAttributes(),
      id: mixpanel.get_distinct_id()
    })
  }
})
                  `.trim()}
                  />
                </div>
              )}
            </>
          )}
          {supportsSQL && (
            <>
              {d.dateUpdated === d.dateCreated &&
                d?.settings?.schemaFormat !== "custom" && (
                  <div className="alert alert-info">
                    <FaExclamationTriangle style={{ marginTop: "-2px" }} /> We
                    have prefilled the identifiers and assignment queries below.
                    These queries may require editing to fit your data
                    structure.
                  </div>
                )}
              <div className="my-3 p-3 rounded border bg-white">
                <DataSourceInlineEditIdentifierTypes
                  onSave={updateDataSourceSettings}
                  onCancel={() => undefined}
                  dataSource={d}
                  canEdit={canEdit}
                />
              </div>

              {d.settings?.userIdTypes && d.settings.userIdTypes.length > 1 ? (
                <div className="my-3 p-3 rounded border bg-white">
                  <DataSourceInlineEditIdentityJoins
                    dataSource={d}
                    onSave={updateDataSourceSettings}
                    onCancel={() => undefined}
                    canEdit={canEdit}
                  />
                </div>
              ) : null}

              <div className="my-3 p-3 rounded border bg-white">
                <ExperimentAssignmentQueries
                  dataSource={d}
                  onSave={updateDataSourceSettings}
                  onCancel={() => undefined}
                  canEdit={canEdit}
                />
              </div>
              <div className="my-3 p-3 rounded border bg-white">
                <DataSourceMetrics dataSource={d} canEdit={canEdit} />
              </div>

              <div className="my-3 p-3 rounded border bg-white">
                <DataSourceJupyterNotebookQuery
                  dataSource={d}
                  onSave={updateDataSourceSettings}
                  onCancel={() => undefined}
                  canEdit={canEdit}
                />
              </div>

              {d.properties?.supportsWritingTables && pipelineEnabled ? (
                <div className="my-3 p-3 rounded border bg-white">
                  <DataSourcePipeline
                    dataSource={d}
                    onSave={updateDataSourceSettings}
                    onCancel={() => undefined}
                    canEdit={canEdit}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {editConn && (
        <DataSourceForm
          existing={true}
          data={d}
          source={"datasource-detail"}
          onSuccess={async () => {
            await mutateDefinitions({});
          }}
          onCancel={() => {
            setEditConn(false);
          }}
        />
      )}
      {viewSchema && (
        <Modal
          open={true}
          close={() => setViewSchema(false)}
          closeCta="Close"
          header="Schema Browser"
        >
          <>
            <p>
              Explore the schemas, tables, and table metadata of your connected
              datasource.
            </p>
            <div className="border rounded">
              <SchemaBrowser datasource={d} />
            </div>
          </>
        </Modal>
      )}
    </div>
  );
};
export default DataSourcePage;
