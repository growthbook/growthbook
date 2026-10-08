import React, { useState, FC } from "react";
import { PiDetective } from "react-icons/pi";
import { ProjectInterface } from "shared/types/project";
import { ago } from "shared/dates";
import { Box } from "@radix-ui/themes";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import ProjectModal from "@/components/Projects/ProjectModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgLimits from "@/hooks/useOrgLimits";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import UITooltip from "@/ui/Tooltip";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import { useAddComputedFields, useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import HistoryTable from "@/components/HistoryTable";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();

  const { organization, getOwnerDisplay } = useUser();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null,
  );
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);

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

  const projectsWithOwners = useAddComputedFields(
    projects,
    (p) => ({ ownerNameDisplay: getOwnerDisplay(p.owner) }),
    [getOwnerDisplay],
  );

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
    items: projectsWithOwners,
    localStorageKey: "projects",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: [
      "name^3",
      "description^2",
      "publicId",
      "id",
      "ownerNameDisplay",
    ],
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
      {auditLogOpen && (
        <ModalStandard
          trackingEventModalType=""
          open={true}
          header="Project Audit Log"
          close={() => setAuditLogOpen(false)}
          size="lg"
        >
          <HistoryTable type="project" showName />
        </ModalStandard>
      )}

      <Box mt="4" mb="5">
        <div className="row align-items-center mb-1">
          <div className="col-auto">
            <h2 className="mb-0">Projects</h2>
          </div>
          <div className="flex-1" />
          <div className="col-auto">
            <Link onClick={() => setAuditLogOpen(true)}>Audit log</Link>
          </div>
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
                    field="id"
                    style={{ width: "20%" }}
                  >
                    ID
                  </SortableTableColumnHeader>
                  <TableColumnHeader width="20%">Description</TableColumnHeader>
                  <SortableTableColumnHeader
                    field="ownerNameDisplay"
                    style={{ width: "10%" }}
                  >
                    Owner
                  </SortableTableColumnHeader>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => {
                  const canEdit = permissionsUtil.canUpdateProject(p.id);
                  return (
                    <TableRow key={p.id} style={{ verticalAlign: "middle" }}>
                      <TableCell>
                        {canEdit ? (
                          <Link href={`/project/${p.id}`}>{p.name}</Link>
                        ) : (
                          <span>{p.name}</span>
                        )}
                        {p.restrictAccess ? (
                          <UITooltip content="Restricted access: only users with a role on this Project can access it. Admins always keep access.">
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
                        {p.publicId && (
                          <Box
                            style={{ color: "var(--gray-9)", opacity: 0.85 }}
                          >
                            <Text as="div" size="sm" mono>
                              {p.publicId}
                            </Text>
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        <Text size="sm" mono>
                          {p.id}
                        </Text>
                      </TableCell>
                      <TableCell>
                        {p.description && p.description.length > 80
                          ? p.description.substring(0, 80).trim() + "..."
                          : (p.description ?? "")}
                      </TableCell>
                      <TableCell>{p.ownerNameDisplay}</TableCell>
                      <TableCell>{ago(p.dateCreated)}</TableCell>
                      <TableCell>{ago(p.dateUpdated)}</TableCell>
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
