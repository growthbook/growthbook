import React, { useState, FC } from "react";
import { ProjectInterface } from "shared/types/project";
import { ago } from "shared/dates";
import { Box } from "@radix-ui/themes";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import ProjectModal from "@/components/Projects/ProjectModal";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgLimits from "@/hooks/useOrgLimits";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import ProjectRowMenu from "@/components/Projects/ProjectRowMenu";
import Link from "@/ui/Link";
import UpgradeModal from "@/components/Settings/UpgradeModal";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();
  const { organization } = useUser();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null,
  );
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  const permissionsUtil = usePermissionsUtil();
  const canCreateProjects = permissionsUtil.canCreateProjects();

  const { getMaxProjects } = useOrgLimits();
  const maxProjects = getMaxProjects();
  const nonDemoProjectCount = projects.filter(
    (p) =>
      !isDemoDatasourceProject({
        projectId: p.id,
        organizationId: organization?.id,
      }),
  ).length;
  const atProjectLimit =
    maxProjects !== null && nonDemoProjectCount >= maxProjects;

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
      {upgradeModalOpen && (
        <UpgradeModal
          close={() => setUpgradeModalOpen(false)}
          source="project limit"
          commercialFeature={null}
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
              body={
                !canCreateProjects
                  ? "You don't have permission to create projects"
                  : atProjectLimit
                    ? `Your plan only supports ${maxProjects} project${
                        maxProjects === 1 ? "" : "s"
                      }. Upgrade your plan to create more.`
                    : undefined
              }
              shouldDisplay={!canCreateProjects || atProjectLimit}
            >
              <Button
                disabled={!canCreateProjects}
                onClick={() =>
                  atProjectLimit ? setUpgradeModalOpen(true) : setModalOpen({})
                }
              >
                Create Project
              </Button>
            </Tooltip>
          </div>
        </div>
        <p className="text-gray mb-4">
          Group your ideas and experiments into <strong>Projects</strong> to
          keep things organized and easy to manage.
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
            <table
              className="table appbox gbtable table-valign-top"
              style={{ tableLayout: "fixed", width: "100%" }}
            >
              <thead>
                <tr>
                  <SortableTH field="name" style={{ width: "20%" }}>
                    Project Name
                  </SortableTH>
                  <SortableTH field="computedPublicId" style={{ width: "20%" }}>
                    Public ID
                  </SortableTH>
                  <th style={{ width: "30%" }}>Description</th>
                  <SortableTH field="dateCreated" style={{ width: "15%" }}>
                    Date Created
                  </SortableTH>
                  <SortableTH field="dateUpdated" style={{ width: "15%" }}>
                    Date Updated
                  </SortableTH>
                  <th style={{ width: 40, minWidth: 40 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const canEdit = permissionsUtil.canUpdateProject(p.id);
                  const canDelete =
                    // If the project has the `managedBy` property, we block deletion.
                    permissionsUtil.canDeleteProject(p.id) &&
                    !p.managedBy?.type;
                  const isDemoProject = isDemoDatasourceProject({
                    projectId: p.id,
                    organizationId: organization?.id,
                  });
                  return (
                    <tr key={p.id}>
                      <td className="text-gray">
                        {canEdit ? (
                          <Link href={`/project/${p.id}`}>{p.name}</Link>
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
                          : (p.description ?? "")}
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
                            if (isDemoProject) {
                              // The Sample Data project has a dedicated
                              // endpoint that also removes legacy sample
                              // resources; deleting it like a normal project
                              // can leave sample data behind in a state
                              // that's hard to clean up.
                              await apiCall(`/demo-datasource-project`, {
                                method: "DELETE",
                              });
                            } else {
                              await apiCall(
                                `/projects/${p.id}?deleteResources=${deleteProjectResources ? "true" : "false"}`,
                                {
                                  method: "DELETE",
                                },
                              );
                            }
                            mutateDefinitions();
                          }}
                          deleteProjectResources={
                            // Sample data is always deleted with its project
                            isDemoProject ? null : deleteProjectResources
                          }
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
