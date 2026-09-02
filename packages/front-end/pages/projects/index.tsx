import React, { useState, FC } from "react";
import { PiDetective } from "react-icons/pi";
import { ProjectInterface } from "shared/types/project";
import Link from "next/link";
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
import UITooltip from "@/ui/Tooltip";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import ProjectRowMenu from "@/components/Projects/ProjectRowMenu";
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

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
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
            <Box width="250px" mb="3">
              <Field
                placeholder="Search..."
                type="search"
                containerClassName="mb-0"
                {...searchInputProps}
              />
            </Box>
            <Table variant="surface" layout="fixed">
              <TableHeader>
                <TableRow>
                  <SortableTableColumnHeader
                    field="name"
                    style={{ width: "20%" }}
                  >
                    Project Name
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader
                    field="computedPublicId"
                    style={{ width: "20%" }}
                  >
                    Public ID
                  </SortableTableColumnHeader>
                  <TableColumnHeader width="30%">Description</TableColumnHeader>
                  <SortableTableColumnHeader
                    field="dateCreated"
                    style={{ width: "15%" }}
                  >
                    Date Created
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader
                    field="dateUpdated"
                    style={{ width: "15%" }}
                  >
                    Date Updated
                  </SortableTableColumnHeader>
                  <TableColumnHeader width="50px" />
                </TableRow>
              </TableHeader>
              <TableBody>
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
                    <TableRow key={p.id}>
                      <TableCell>
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
                        {p.restrictAccess ? (
                          <UITooltip content="Restricted access: only users with a role on this Project can access it.">
                            <span
                              className="ml-1"
                              style={{ color: "var(--amber-11)" }}
                            >
                              <PiDetective size={14} />
                            </span>
                          </UITooltip>
                        ) : null}
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
                      <TableCell>
                        <code className="small">{p.publicId || p.id}</code>
                      </TableCell>
                      <TableCell>
                        {p.description && p.description.length > 80
                          ? p.description.substring(0, 80).trim() + "..."
                          : (p.description ?? "")}
                      </TableCell>
                      <TableCell>{ago(p.dateCreated)}</TableCell>
                      <TableCell>{ago(p.dateUpdated)}</TableCell>
                      <TableCell>
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
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!items.length && isFiltered && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No matching projects
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
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
