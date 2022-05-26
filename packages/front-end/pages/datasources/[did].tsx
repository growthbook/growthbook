import Link from "next/link";
import { useRouter } from "next/router";
import React, { FC, useState } from "react";
import { FaAngleLeft, FaCloudDownloadAlt, FaCode, FaKey } from "react-icons/fa";
import DeleteButton from "../../components/DeleteButton";
import Button from "../../components/Button";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import DataSourceForm from "../../components/Settings/DataSourceForm";
import EditDataSourceSettingsForm from "../../components/Settings/EditDataSourceSettingsForm";
import LoadingOverlay from "../../components/LoadingOverlay";
import Code from "../../components/Code";
import { hasFileConfig } from "../../services/env";
import usePermissions from "../../hooks/usePermissions";

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
  const supportsImports = d.properties?.pastExperiments;

  const joinTables = (d.settings?.queries?.identityJoins || []).filter(
    (j) => j.query.length > 1
  );

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
        {canEdit && (
          <div className="col-auto">
            <DeleteButton
              displayName={d.name}
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
        <div className="col-md-9">
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
      )}:  result.variationId
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
              <div className="mb-4">
                <h3>Identifier Types</h3>
                <p>
                  The different units you use to split traffic in an experiment.
                </p>
                {d.settings?.userIdTypes?.map(({ userIdType, description }) => (
                  <div
                    className="bg-white border mb-3 p-3 ml-3"
                    key={userIdType}
                  >
                    <h4>{userIdType}</h4>
                    {description && <div>{description}</div>}
                  </div>
                ))}
              </div>
              <div className="mb-4">
                <h3>Experiment Assignment Queries</h3>
                <p>
                  Returns a record of which experiment variation was assigned to
                  each user.
                </p>
                {d.settings.queries?.exposure?.map((e) => (
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
              {joinTables.length > 0 && d.settings?.userIdTypes?.length > 1 && (
                <div className="mb-4">
                  <h3>Identifier Join Tables</h3>
                  <p>
                    Joins different identifier types together when needed during
                    experiment analysis.
                  </p>
                  {joinTables.map((t, i) => (
                    <div className="bg-white border mb-3" key={i}>
                      <h4 className="pt-3 px-3">{t.ids.join(", ")}</h4>
                      <Code
                        language="sql"
                        theme="light"
                        code={t.query}
                        containerClassName="mb-0"
                        expandable={true}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="mb-4">
                <h3>Jupyter Notebook Query Runner</h3>
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
                    No query runner defined, Jupyter export is disabled.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="col-md-3">
          {supportsImports &&
            permissions.runQueries &&
            permissions.createAnalyses && (
              <div className="card">
                <div className="card-body">
                  <h2>Import Past Experiments</h2>
                  <p>
                    If you have past experiments already in your data source,
                    you can import them to GrowthBook.
                  </p>
                  <Button
                    color="outline-primary"
                    onClick={async () => {
                      const res = await apiCall<{ id: string }>(
                        "/experiments/import",
                        {
                          method: "POST",
                          body: JSON.stringify({
                            datasource: d.id,
                          }),
                        }
                      );
                      if (res.id) {
                        await router.push(`/experiments/import/${res.id}`);
                      }
                    }}
                  >
                    <FaCloudDownloadAlt /> Import
                  </Button>
                </div>
              </div>
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
