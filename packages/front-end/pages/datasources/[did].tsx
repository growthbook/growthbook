import Link from "next/link";
import { useRouter } from "next/router";
import React, { FC, useCallback, useState } from "react";
import {
  FaDatabase,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaKey,
  FaPencilAlt,
  FaPlus,
} from "react-icons/fa";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { MetricInterface } from "@/../back-end/types/metric";
import { ago, datetime } from "@/../shared/dates";
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
import { GBCircleArrowLeft } from "@/components/Icons";
import useApi from "@/hooks/useApi";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import MetricForm from "@/components/Metrics/MetricForm";

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
  const [modalData, setModalData] = useState<{
    current: Partial<MetricInterface>;
    edit: boolean;
    duplicate: boolean;
  } | null>(null);

  const {
    getDatasourceById,
    project,
    mutateDefinitions,
    ready,
    error,
  } = useDefinitions();
  const { did } = router.query as { did: string };
  const d = getDatasourceById(did);
  const [
    showAutoGenerateMetricsModal,
    setShowAutoGenerateMetricsModal,
  ] = useState(false);

  const { apiCall } = useAuth();

  const canEdit =
    (d &&
      checkDatasourceProjectPermissions(d, permissions, "createDatasources") &&
      !hasFileConfig()) ||
    false;

  const { data, mutate } = useApi<{
    metrics: MetricInterface[];
  }>(`/datasource/${did}/metrics`);

  const metrics: MetricInterface[] | undefined = data?.metrics;

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

  const closeModal = () => {
    setModalData(null);
  };
  const onSuccess = () => {
    mutateDefinitions();
    mutate();
  };

  const supportsSQL = d.properties?.queryLanguage === "sql";
  const supportsEvents = d.properties?.events || false;

  return (
    <div className="container pagecontents">
      {modalData && (
        <MetricForm
          {...modalData}
          onClose={closeModal}
          onSuccess={onSuccess}
          source="datasource-detail"
          openAutoGenerateMetrics={() => setShowAutoGenerateMetricsModal(true)}
        />
      )}
      {showAutoGenerateMetricsModal && (
        // TODO: Should I make this a component?
        // I could make the component hit the endpoint to fetch the trackedEvents on load, so I can keep the state entirely encompassed within the component
        <Modal
          size="lg"
          open={true}
          close={() => setShowAutoGenerateMetricsModal(false)}
        >
          Hi
          {/* //TODO: This is where we'll put the auto generate metrics modal */}
        </Modal>
      )}
      <div className="mb-2">
        <Link href="/datasources">
          <a>
            <GBCircleArrowLeft /> Back to all data sources
          </a>
        </Link>
      </div>
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
          <span className="badge badge-secondary">{d.type}</span>{" "}
          <span className="badge badge-success">connected</span>
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

              <h2 className="mt-4">Identifiers</h2>
              <p>
                The different units you use to split traffic in an experiment.
              </p>

              <div className="card py-3 px-3 mb-4">
                <DataSourceInlineEditIdentifierTypes
                  onSave={updateDataSourceSettings}
                  onCancel={() => undefined}
                  dataSource={d}
                  canEdit={canEdit}
                />

                <div className="mt-4">
                  <DataSourceInlineEditIdentityJoins
                    dataSource={d}
                    onSave={updateDataSourceSettings}
                    onCancel={() => undefined}
                    canEdit={canEdit}
                  />
                </div>
              </div>

              <div className="my-5">
                <ExperimentAssignmentQueries
                  dataSource={d}
                  onSave={updateDataSourceSettings}
                  onCancel={() => undefined}
                  canEdit={canEdit}
                />
              </div>

              <div className="my-5">
                <div className="d-flex flex-row justify-content-between align-items-center">
                  <div>
                    <h2>Metrics</h2>
                    <p>
                      Metrics are what your experiments are trying to improve
                      (or at least not hurt). Below are the metrics defined from
                      this data source.{" "}
                      <DocLink docSection="metrics">Learn more.</DocLink>
                    </p>
                  </div>
                  {permissions.check("createMetrics", project) &&
                    !hasFileConfig() && (
                      <div className="col-auto">
                        <button
                          className="btn btn-outline-primary font-weight-bold text-nowrap"
                          onClick={() =>
                            setModalData({
                              current: { datasource: d.id },
                              edit: false,
                              duplicate: false,
                            })
                          }
                        >
                          <FaPlus className="mr-1" /> Add
                        </button>
                      </div>
                    )}
                </div>

                {metrics && metrics?.length > 0 ? (
                  <div>
                    {metrics.map((metric) => {
                      return (
                        <div key={metric.id} className="card p-3 mb-3">
                          <Link href={`/metric/${metric.id}`}>
                            <div
                              className="d-flex flex-row align-items-center justify-content-between"
                              role="button"
                            >
                              <div className="mr-5 w-100">
                                <h4>{metric.name}</h4>
                                <div className="d-flex flex-row align-items-center justify-content-between">
                                  <div>
                                    <strong>Type: </strong>
                                    <code>{metric.type}</code>
                                  </div>
                                  <div>
                                    <strong>Owner: </strong>
                                    {metric.owner}
                                  </div>
                                  {!hasFileConfig() && (
                                    <div
                                      title={datetime(metric.dateUpdated || "")}
                                      className="d-none d-md-table-cell"
                                    >
                                      <strong>Last Updated: </strong>
                                      {ago(metric.dateUpdated || "")}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div
                                style={{ cursor: "initial" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                }}
                              >
                                <MoreMenu>
                                  <Link href={`/metric/${metric.id}`}>
                                    <button
                                      className="dropdown-item py-2"
                                      onClick={() => console.log("hey")}
                                    >
                                      <FaPencilAlt className="mr-2" /> Edit
                                    </button>
                                  </Link>
                                  <DeleteButton
                                    onClick={() => console.log("hey")}
                                    className="dropdown-item text-danger py-2"
                                    iconClassName="mr-2"
                                    style={{ borderRadius: 0 }}
                                    useIcon
                                    displayName={metric.name}
                                    deleteMessage={`Are you sure you want to delete identifier join ${metric.name}?`}
                                    title="Delete"
                                    text="Delete"
                                    outline={false}
                                  />
                                </MoreMenu>
                              </div>
                            </div>
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="alert alert-info">
                    No metrics have been defined from this data source.
                  </div>
                )}
              </div>

              <div className="my-5">
                <DataSourceJupyterNotebookQuery
                  dataSource={d}
                  onSave={updateDataSourceSettings}
                  onCancel={() => undefined}
                  canEdit={canEdit}
                />
              </div>
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
