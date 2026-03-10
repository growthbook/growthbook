import React, { useState, FC } from "react";
import { ProjectInterface } from "shared/types/project";
import { useRouter } from "next/router";
import Link from "next/link";
import { date } from "shared/dates";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ProjectModal from "@/components/Projects/ProjectModal";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();
  const router = useRouter();

  const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null,
  );

  const permissionsUtil = usePermissionsUtil();
  const canCreateProjects = permissionsUtil.canCreateProjects();

  const [deleteProjectResources, setDeleteProjectResources] =
    useState<boolean>(true);

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
            <Button
              disabled={!canCreateProjects}
              onClick={() => setModalOpen({})}
            >
              Create Project
            </Button>
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
              const canDelete =
                // If the project has the `managedBy` property, we block deletion.
                permissionsUtil.canDeleteProject(p.id) && !p.managedBy?.type;
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
                    {p.managedBy?.type ? (
                      <div>
                        <Badge
                          label={`Managed by ${capitalizeFirstLetter(
                            p.managedBy.type,
                          )}`}
                        />
                      </div>
                    ) : null}
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
                          displayName={p.name}
                          text="Delete"
                          useIcon={false}
                          onClick={async () => {
                            await apiCall(
                              `/projects/${p.id}?deleteResources=${deleteProjectResources ? "true" : "false"}`,
                              {
                                method: "DELETE",
                              },
                            );
                            mutateDefinitions();
                          }}
                          additionalMessage={
                            <>
                              <Checkbox
                                value={deleteProjectResources}
                                setValue={(v) => setDeleteProjectResources(v)}
                                label="Also delete all of this project's resources"
                                description="Features, experiments, etc."
                              />

                              {!deleteProjectResources && (
                                <Callout status="warning" mt="3">
                                  <strong>Warning:</strong> You may end up with
                                  orphaned resources that will need to be
                                  cleaned up manually.
                                </Callout>
                              )}
                            </>
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
