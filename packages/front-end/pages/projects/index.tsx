import React, { useState, FC } from "react";
import {
  FaExclamationTriangle,
  FaFolderPlus,
  FaPencilAlt,
} from "react-icons/fa";
import { ProjectInterface } from "back-end/types/project";
import { useRouter } from "next/router";
import Link from "next/link";
import { date } from "shared/dates";
import usePermissions from "@front-end/hooks/usePermissions";
import DeleteButton from "@front-end/components/DeleteButton/DeleteButton";
import ProjectModal from "@front-end/components/Projects/ProjectModal";
import { useAuth } from "@front-end/services/auth";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import MoreMenu from "@front-end/components/Dropdown/MoreMenu";
import useSDKConnections from "@front-end/hooks/useSDKConnections";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();
  const router = useRouter();

  const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );

  const { data: sdkConnectionsData } = useSDKConnections();

  const permissions = usePermissions();
  const manageProjectsPermissions: { [id: string]: boolean } = {};
  projects.forEach(
    (p) =>
      (manageProjectsPermissions[p.id] = permissions.check(
        "manageProjects",
        p.id
      ))
  );

  return (
    <div className="container-fluid  pagecontents">
      {modalOpen && (
        <ProjectModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}

      <div className="filters md-form row mb-3 align-items-center">
        <div className="col-auto d-flex">
          <h1>Projects</h1>
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              setModalOpen({});
            }}
          >
            <FaFolderPlus /> Create Project
          </button>
        </div>
      </div>

      <p>
        Group your ideas and experiments into <strong>Projects</strong> to keep
        things organized and easy to manage.
      </p>
      {projects.length > 0 ? (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th className="col-3">Project Name</th>
              <th className="col-3">Description</th>
              <th className="col-2">Id</th>
              <th className="col-2">Date Created</th>
              <th className="col-2">Date Updated</th>
              <th className="w-50"></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const canManage = manageProjectsPermissions[p.id];
              return (
                <tr
                  key={p.id}
                  onClick={
                    canManage
                      ? () => {
                          router.push(`/project/${p.id}`);
                        }
                      : undefined
                  }
                  style={canManage ? { cursor: "pointer" } : {}}
                >
                  <td>
                    {canManage ? (
                      <Link
                        href={`/project/${p.id}`}
                        className="font-weight-bold"
                      >
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-weight-bold">{p.name}</span>
                    )}
                  </td>
                  <td className="pr-5 text-gray" style={{ fontSize: 12 }}>
                    {p.description}
                  </td>
                  <td>{p.id}</td>
                  <td>{date(p.dateCreated)}</td>
                  <td>{date(p.dateUpdated)}</td>
                  <td
                    style={{ cursor: "initial" }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    {canManage && (
                      <MoreMenu>
                        <button
                          className="btn dropdown-item py-2"
                          onClick={() => {
                            setModalOpen(p);
                          }}
                        >
                          <FaPencilAlt /> Edit
                        </button>
                        <DeleteButton
                          className="btn dropdown-item py-2"
                          displayName="project"
                          text="Delete"
                          onClick={async () => {
                            await apiCall(`/projects/${p.id}`, {
                              method: "DELETE",
                            });
                            mutateDefinitions();
                          }}
                          additionalMessage={
                            sdkConnectionsData?.connections?.find((c) =>
                              c.projects.includes(p.id)
                            ) ? (
                              <div className="alert alert-danger px-2 py-1">
                                <FaExclamationTriangle /> This project is in use
                                by one or more SDK Connections. Deleting it will
                                cause those connections to stop working.
                              </div>
                            ) : null
                          }
                        />
                      </MoreMenu>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p>Click the button in the top right to create your first project!</p>
      )}
    </div>
  );
};
export default ProjectsPage;
