import React, { FC, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { FaExclamationTriangle } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { datetime } from "@/services/dates";
import { hasFileConfig } from "@/services/env";
import usePermissions from "@/hooks/usePermissions";
import { GBAddCircle } from "../Icons";
import LoadingOverlay from "../LoadingOverlay";
import { DocLink } from "../DocLink";
import Tooltip from "../Tooltip/Tooltip";
import NewDataSourceForm from "./NewDataSourceForm";

const DataSources: FC = () => {
  const [newModalOpen, setNewModalOpen] = useState(false);

  const router = useRouter();

  const { datasources, error, mutateDefinitions, ready } = useDefinitions();

  const permissions = usePermissions();

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }
  if (!ready) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      {datasources.length > 0 ? (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th className="col-3">Display Name</th>
              <th className="col-auto">Description</th>
              <th className="col-2">Type</th>
              {!hasFileConfig() && <th className="col-2">Date Added</th>}
            </tr>
          </thead>
          <tbody>
            {datasources.map((d, i) => (
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
                {!hasFileConfig() && <td>{datetime(d.dateCreated)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div>
          <p>
            Connect GrowthBook to your data so we can automatically fetch
            experiment results and metric values. We currently support{" "}
            <strong>Redshift</strong>, <strong>Snowflake</strong>,{" "}
            <strong>BigQuery</strong>, <strong>ClickHouse</strong>,{" "}
            <strong>Postgres</strong>, <strong>MySQL</strong>,{" "}
            <strong>MS SQL/SQL Server</strong>, <strong>Athena</strong>,{" "}
            <strong>PrestoDB</strong>,<strong>Mixpanel</strong>, and{" "}
            <strong>Google Analytics</strong> with more coming soon.
          </p>
          <p>
            We only ever fetch aggregate data, so none of your user&apos;s
            Personally Identifiable Information ever hits our servers. Plus, we
            use multiple layers of encryption to store your credentials and
            require minimal read-only permissions, so you can be sure your
            source data remains secure.
          </p>
          {hasFileConfig() && (
            <div className="alert alert-info">
              It looks like you have a <code>config.yml</code> file. Data
              sources defined there will show up on this page.{" "}
              <DocLink docSection="config_yml">View Documentation</DocLink>
            </div>
          )}
        </div>
      )}

      {!hasFileConfig() && permissions.createDatasources && (
        <button
          className="btn btn-primary"
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
            settings: {},
          }}
          source="datasource-list"
          onSuccess={async (id) => {
            await mutateDefinitions({});
            setNewModalOpen(false);
            await router.push(`/datasources/${id}`);
          }}
          onCancel={() => {
            setNewModalOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default DataSources;
