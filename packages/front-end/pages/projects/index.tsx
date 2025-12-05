import React, { useState, FC } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { ProjectInterface } from "back-end/types/project";
import { useRouter } from "next/router";
import Link from "next/link";
import { date } from "shared/dates";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ProjectModal from "@/components/Projects/ProjectModal";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import useSDKConnections from "@/hooks/useSDKConnections";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();
  const router = useRouter();

  const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null,
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
        <Table variant="standard" hover className="appbox">
          <TableHeader>
            <TableRow>
              <TableColumnHeader className="col-3">Project Name</TableColumnHeader>
              <TableColumnHeader className="col-3">Description</TableColumnHeader>
              <TableColumnHeader className="col-2">Id</TableColumnHeader>
              <TableColumnHeader className="col-2">Date Created</TableColumnHeader>
              <TableColumnHeader className="col-2">Date Updated</TableColumnHeader>
              <TableColumnHeader className="w-50"></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => {
              const canEdit = permissionsUtil.canUpdateProject(p.id);
              const canDelete =
                // If the project has the `managedBy` property, we block deletion.
                permissionsUtil.canDeleteProject(p.id) && !p.managedBy?.type;
              return (
                <TableRow
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
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="pr-5 text-gray" style={{ fontSize: 12 }}>
                    {p.description}
                  </TableCell>
                  <TableCell>{p.id}</TableCell>
                  <TableCell>{date(p.dateCreated)}</TableCell>
                  <TableCell>{date(p.dateUpdated)}</TableCell>
                  <TableCell
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
                              c.projects.includes(p.id),
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p>Click the button in the top right to create your first project!</p>
      )}
    </div>
  );
};
export default ProjectsPage;
