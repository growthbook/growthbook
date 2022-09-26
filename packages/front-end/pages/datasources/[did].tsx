import Link from "next/link";
import { useRouter } from "next/router";
import React, { FC, useCallback, useState } from "react";
import {
  FaAngleLeft,
  FaCode,
  FaExternalLinkAlt,
  FaKey,
  FaPencilAlt,
  FaPlus,
} from "react-icons/fa";
import DeleteButton from "../../components/DeleteButton";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import DataSourceForm from "../../components/Settings/DataSourceForm";
import EditDataSourceSettingsForm from "../../components/Settings/EditDataSourceSettingsForm";
import LoadingOverlay from "../../components/LoadingOverlay";
import Code from "../../components/Code";
import { hasFileConfig } from "../../services/env";
import usePermissions from "../../hooks/usePermissions";
import { DocLink, DocSection } from "../../components/DocLink";
import {
  DataSourceEditingResourceType,
  DataSourceUIMode,
} from "../../components/Settings/EditDataSource/types";
import { EditJupyterNotebookQueryRunner } from "../../components/Settings/EditDataSource/EditJupyterNotebookQueryRunner";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DataSourceInlineEditIdentifierTypes } from "../../components/Settings/EditDataSource/DataSourceInlineEditIdentifierTypes/DataSourceInlineEditIdentifierTypes";
import { DataSourceInlineEditIdentityJoins } from "../../components/Settings/EditDataSource/DataSourceInlineEditIdentityJoins/DataSourceInlineEditIdentityJoins";

function quotePropertyName(name: string) {
  if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
    return name;
  }
  return JSON.stringify(name);
}

const DataSourcePage: FC = () => {
  const [editConn, setEditConn] = useState(false);
  const [editSettings, setEditSettings] = useState(false);

  const permissions = usePermissions();

  const canEdit = !hasFileConfig();

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

  // region New Editing by section

  const [uiMode, setUiMode] = useState<DataSourceUIMode>("view");
  const [
    editingResource,
    setEditingResource,
  ] = useState<DataSourceEditingResourceType | null>(null);

  const updateDataSource = useCallback(
    async (dataSource: DataSourceInterfaceWithParams) => {
      await apiCall(`/datasource/${dataSource.id}`, {
        method: "PUT",
        body: JSON.stringify(dataSource),
      });

      await mutateDefinitions({});

      setUiMode("view");
      setEditingResource(null);
    },
    [mutateDefinitions, apiCall]
  );

  const cancelUpdateDataSource = useCallback(() => {
    setUiMode("view");
    setEditingResource(null);
  }, []);

  // endregion New Editing by section

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }
  if (!ready) {
    return <LoadingOverlay />;
  }
  if (!d) {
    return (
      <div className="alert alert-danger">
        Datasource <code>{did}</code> does not exist.
      </div>
    );
  }

  const supportsSQL = d.properties?.queryLanguage === "sql";
  const supportsEvents = d.properties?.events || false;

  return (
    <div className="container mt-3 pagecontents">
      <div className="mb-2">
        <Link href="/datasources">
          <a>
            <FaAngleLeft /> All Data Sources
          </a>
        </Link>
      </div>
      <div className="row mb-3 align-items-center">
        <div className="col-auto">
          <h1 className="mb-0">{d.name}</h1>
        </div>
        <div className="col-auto">
          <span className="badge badge-secondary">{d.type}</span>{" "}
          <span className="badge badge-success">connected</span>
        </div>
        <div style={{ flex: 1 }} />
        {canEdit && permissions.createDatasources && (
          <div className="col-auto">
            <DeleteButton
              displayName={d.name}
              className="font-weight-bold"
              text="Delete"
              onClick={async () => {
                await apiCall(`/datasource/${d.id}`, {
                  method: "DELETE",
                });
                mutateDefinitions({});
                router.push("/datasources");
              }}
            />
          </div>
        )}
      </div>

      <div className="row">
        <div className="col-md-12">
          <div className="row mb-3">
            {canEdit && permissions.createDatasources && (
              <div className="col-auto">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditConn(true);
                  }}
                >
                  <FaKey /> Edit Connection Info
                </a>
              </div>
            )}
            {(supportsSQL || supportsEvents) &&
              canEdit &&
              permissions.editDatasourceSettings && (
                <div className="col-auto">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditSettings(true);
                    }}
                  >
                    <FaCode /> Edit Query Settings
                  </a>
                </div>
              )}
            <div className="col-auto ml-auto">
              <DocLink
                docSection={d.type as DocSection}
                fallBackSection="datasources"
              >
                <FaExternalLinkAlt /> View documentation
              </DocLink>
            </div>
          </div>
          {!d.properties?.hasSettings && (
            <div className="alert alert-info">
              This data source does not require any additional configuration.
            </div>
          )}
          {supportsEvents && d?.settings?.events && (
            <>
              <h3 className="mb-3">Query Settings</h3>
              <table className="table appbox gbtable mb-5">
                <tbody>
                  <tr>
                    <th>Experiment Event</th>
                    <td>
                      <code>{d.settings.events.experimentEvent || ""}</code>
                    </td>
                  </tr>
                  <tr>
                    <th>Experiment Id Property</th>
                    <td>
                      <code>
                        {d.settings.events.experimentIdProperty || ""}
                      </code>
                    </td>
                  </tr>
                  <tr>
                    <th>Variation Id Property</th>
                    <td>
                      <code>{d.settings.events.variationIdProperty || ""}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
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
    mixpanel.track(${JSON.stringify(d.settings.events.experimentEvent)}, {
      ${quotePropertyName(
        d.settings.events.experimentIdProperty
      )}: experiment.key,
      ${quotePropertyName(
        d.settings.events.variationIdProperty
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
              <h2 className="mt-4">Identifiers</h2>
              <p>
                The different units you use to split traffic in an experiment.
              </p>

              <div className="card py-3 px-3 mb-4">
                {/* TODO: design changes for Identity Joins nested */}
                {/* region Identifier Types */}
                <DataSourceInlineEditIdentifierTypes
                  onSave={updateDataSource}
                  onCancel={cancelUpdateDataSource}
                  dataSource={d}
                />
                {/* endregion Identifier Types */}

                <div className="mt-4">
                  {/* region Identity Joins */}
                  <DataSourceInlineEditIdentityJoins
                    dataSource={d}
                    onSave={updateDataSource}
                    onCancel={cancelUpdateDataSource}
                  />
                </div>
                {/* endregion Identity Joins */}
              </div>

              <div className="mb-4">
                <h3>Experiment Assignment Queries</h3>
                <p>
                  Returns a record of which experiment variation was assigned to
                  each user.
                </p>
                {d.settings?.queries?.exposure?.map((e) => (
                  <div className="bg-white border mb-3 ml-3" key={e.id}>
                    <div className="px-3 pt-3">
                      <h4>{e.name}</h4>
                      {e.description && <p>{e.description}</p>}
                      <div className="row">
                        <div className="col-auto">
                          <strong>Identifier: </strong>
                          <code>{e.userIdType}</code>
                        </div>
                        <div className="col-auto">
                          <strong>Dimension Columns: </strong>
                          {e.dimensions.map((d, i) => (
                            <React.Fragment key={i}>
                              {i ? ", " : ""}
                              <code key={d}>{d}</code>
                            </React.Fragment>
                          ))}
                          {!e.dimensions.length && (
                            <em className="text-muted">none</em>
                          )}
                        </div>
                      </div>
                    </div>
                    <Code
                      language="sql"
                      theme="light"
                      code={e.query}
                      containerClassName="mb-0"
                      expandable={true}
                    />
                  </div>
                ))}
              </div>

              {/* region Jupyter Notebook */}
              <div className="mb-4">
                <div className="d-flex justify-content-between align-items-center">
                  <div className="">
                    <h3>Jupyter Notebook Query Runner</h3>
                  </div>

                  <div className="">
                    <button
                      className="btn btn-outline-primary font-weight-bold"
                      onClick={() => {
                        setUiMode("edit");
                        setEditingResource("jupyter_notebook");
                      }}
                    >
                      {d.settings.notebookRunQuery ? (
                        <>
                          <FaPencilAlt className="mr-1" /> Edit
                        </>
                      ) : (
                        <>
                          <FaPlus className="mr-1" /> Add
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <p>
                  Tell us how to query this data source from within a Jupyter
                  notebook environment.
                </p>
                {d.settings?.notebookRunQuery ? (
                  <Code
                    theme="light"
                    code={d.settings.notebookRunQuery}
                    language="python"
                    expandable={true}
                  />
                ) : (
                  <div className="alert alert-info">
                    Used when exporting experiment results to a Jupyter notebook
                  </div>
                )}
              </div>

              {d &&
              uiMode === "edit" &&
              editingResource === "jupyter_notebook" ? (
                <EditJupyterNotebookQueryRunner
                  onSave={updateDataSource}
                  onCancel={cancelUpdateDataSource}
                  dataSource={d}
                />
              ) : null}

              {/* endregion Jupyter Notebook */}
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

      {editSettings && (
        <EditDataSourceSettingsForm
          data={d}
          source={"datasource-detail"}
          onSuccess={() => {
            mutateDefinitions({});
          }}
          onCancel={() => {
            setEditSettings(false);
          }}
        />
      )}
    </div>
  );
};
export default DataSourcePage;
