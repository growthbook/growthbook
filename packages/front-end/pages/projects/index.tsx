import React, { useState, FC } from "react";
import { FaExclamationTriangle, FaFolderPlus } from "react-icons/fa";
import { ProjectInterface } from "back-end/types/project";
import { useRouter } from "next/router";
import Link from "next/link";
import { date } from "shared/dates";
import DeleteButton from "@front-end/components/DeleteButton/DeleteButton";
import ProjectModal from "@front-end/components/Projects/ProjectModal";
import { useAuth } from "@front-end/services/auth";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import MoreMenu from "@front-end/components/Dropdown/MoreMenu";
import useSDKConnections from "@front-end/hooks/useSDKConnections";
import usePermissionsUtil from "@front-end/hooks/usePermissionsUtils";
import Tooltip from "@front-end/components/Tooltip/Tooltip";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();
  const router = useRouter();

  const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );

  const { data: sdkConnectionsData } = useSDKConnections();

  const permissionsUtil = usePermissionsUtil();
  const canCreateProjects = permissionsUtil.canCreateProjects();

  return (
    <div className="container-fluid  pagecontents">
      {modalOpen && (
        <ProjectModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}

      <div className="filters md-form row mb-1 align-items-center">
        <div className="col-auto d-flex">
          <h1 className="mb-0">Projects</h1>
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <Tooltip
            body="You don't have permission to create projects"
            shouldDisplay={!canCreateProjects}
          >
            <button
              disabled={!canCreateProjects}
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen({});
              }}
            >
              <FaFolderPlus /> Create Project
            </button>
          </Tooltip>
        </div>
      </div>

      <p className="text-gray mb-3">
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
              const canEdit = permissionsUtil.canUpdateProject(p.id);
              const canDelete = permissionsUtil.canDeleteProject(p.id);
              return (
                <tr
                  key={p.id}
                  onClick={
                    canEdit
                      ? () => {
                          router.push(`/project/${p.id}`);
                        }
                      : undefined
                  }
                  style={canEdit ? { cursor: "pointer" } : {}}
                >
                  <td>
                    {canEdit ? (
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
                    <MoreMenu>
                      {canEdit ? (
                        <button
                          className="btn dropdown-item"
                          onClick={() => {
                            setModalOpen(p);
                          }}
                        >
                          Edit
                        </button>
                      ) : null}
                      {canDelete ? (
                        <DeleteButton
                          className="dropdown-item text-danger"
                          displayName="project"
                          text="Delete"
                          useIcon={false}
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
                      ) : null}
                    </MoreMenu>
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
