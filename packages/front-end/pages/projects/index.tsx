import React, { useState, FC } from "react";
import { ProjectInterface } from "shared/types/project";
import Link from "next/link";
import { ago } from "shared/dates";
import { Box } from "@radix-ui/themes";
import ProjectModal from "@/components/Projects/ProjectModal";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import ProjectRowMenu from "@/components/Projects/ProjectRowMenu";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null,
  );

  const permissionsUtil = usePermissionsUtil();
  const canCreateProjects = permissionsUtil.canCreateProjects();

  const [deleteProjectResources, setDeleteProjectResources] =
    useState<boolean>(true);

  // Enhance projects with computed publicId for sorting
  const projectsWithComputedPublicId = projects.map((p) => ({
    ...p,
    computedPublicId: p.publicId || p.id,
  }));

  const { items, searchInputProps, isFiltered, SortableTH, pagination } =
    useSearch({
      items: projectsWithComputedPublicId,
      localStorageKey: "projects",
      defaultSortField: "dateCreated",
      defaultSortDir: -1,
      searchFields: ["name^3", "description^2", "computedPublicId"],
      pageSize: 50,
      updateSearchQueryOnChange: true,
    });

  return (
    <div className="container-fluid pagecontents">
      {modalOpen && (
        <ProjectModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}

      <Box mt="4" mb="5">
        <div className="row align-items-center mb-1">
          <div className="col-auto">
            <h2 className="mb-0">Projects</h2>
          </div>
          <div className="flex-1" />
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
        <p className="text-gray mb-4">
          Group your ideas and experiments into <strong>Projects</strong> to keep
          things organized and easy to manage.
        </p>

      {projects.length > 0 ? (
        <>
          <Box className="relative" width="40%" mb="4">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </Box>
          <table className="table appbox gbtable table-valign-top" style={{ tableLayout: "fixed", width: "100%" }}>
            <thead>
              <tr>
                <SortableTH field="name" style={{ width: "20%" }}>Project Name</SortableTH>
                <SortableTH field="computedPublicId" style={{ width: "20%" }}>Public ID</SortableTH>
                <th style={{ width: "30%" }}>Description</th>
                <SortableTH field="dateCreated" style={{ width: "15%" }}>Date Created</SortableTH>
                <SortableTH field="dateUpdated" style={{ width: "15%" }}>Date Updated</SortableTH>
                <th style={{ width: 40, minWidth: 40 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const canEdit = permissionsUtil.canUpdateProject(p.id);
                const canDelete =
                  // If the project has the `managedBy` property, we block deletion.
                  permissionsUtil.canDeleteProject(p.id) && !p.managedBy?.type;
                return (
                  <tr key={p.id}>
                    <td className="text-gray">
                      {canEdit ? (
                        <Link
                          className="link-purple"
                          href={`/project/${p.id}`}
                        >
                          {p.name}
                        </Link>
                      ) : (
                        <span>{p.name}</span>
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
                    <td className="text-gray">
                      <code className="small">{p.publicId || p.id}</code>
                    </td>
                    <td className="text-gray">
                      {p.description && p.description.length > 80
                        ? p.description.substring(0, 80).trim() + "..."
                        : p.description ?? ""}
                    </td>
                    <td className="text-gray">{ago(p.dateCreated)}</td>
                    <td className="text-gray">{ago(p.dateUpdated)}</td>
                    <td>
                      <ProjectRowMenu
                        project={p}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        onEdit={() => setModalOpen(p)}
                        onDelete={async () => {
                          await apiCall(
                            `/projects/${p.id}?deleteResources=${deleteProjectResources ? "true" : "false"}`,
                            {
                              method: "DELETE",
                            },
                          );
                          mutateDefinitions();
                        }}
                        deleteProjectResources={deleteProjectResources}
                        setDeleteProjectResources={setDeleteProjectResources}
                      />
                    </td>
                  </tr>
                );
              })}
              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={6} align={"center"}>
                    No matching projects
                  </td>
                </tr>
              )}
            </tbody>
          </table>
            {pagination}
          </>
        ) : (
          <p>Click the button above to create your first project!</p>
        )}
      </Box>
    </div>
  );
};
export default ProjectsPage;
