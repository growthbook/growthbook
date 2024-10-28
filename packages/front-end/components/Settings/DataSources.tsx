import React, { FC } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { FaExclamationTriangle } from "react-icons/fa";
import { ago } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import ProjectBadges from "@/components/ProjectBadges";
import { hasFileConfig } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";

const DataSources: FC = () => {
  const router = useRouter();

  const { datasources, project, error, ready } = useDefinitions();
  const filteredDatasources = project
    ? datasources.filter((ds) =>
        isProjectListValidForProject(ds.projects, project)
      )
    : datasources;

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }
  if (!ready) {
    return <LoadingOverlay />;
  }

  return (
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
                      Could not decrypt the connection settings for this data
                      source. Click on the data source name for more info.
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
            {!hasFileConfig() && <td>{ago(d.dateUpdated || "")}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default DataSources;
