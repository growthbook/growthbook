import React, { useState, FC } from "react";
import { ProjectInterface } from "shared/types/project";
import { useRouter } from "next/router";
import Link from "next/link";
import { date } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
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
import Heading from "@/ui/Heading";
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

  const permissionsUtil = usePermissionsUtil();
  const canCreateProjects = permissionsUtil.canCreateProjects();

  const [deleteProjectResources, setDeleteProjectResources] =
    useState<boolean>(true);

  const projectList = projects ?? [];

  return (
    <Box className="container-fluid pagecontents">
      {modalOpen && (
        <ProjectModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}

      <Flex align="center" justify="between" mb="1" gap="3" wrap="wrap">
        <Heading as="h1">Projects</Heading>
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
      </Flex>

      <Box mb="3" style={{ color: "var(--gray-11)" }}>
        <p style={{ margin: 0 }}>
          Group your ideas and experiments into <strong>Projects</strong> to
          keep things organized and easy to manage.
        </p>
      </Box>
      {projectList.length > 0 ? (
        <Table variant="list" stickyHeader roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader style={{ width: "22%" }}>
                Project Name
              </TableColumnHeader>
              <TableColumnHeader style={{ width: "22%" }}>
                Description
              </TableColumnHeader>
              <TableColumnHeader style={{ width: "14%" }}>Id</TableColumnHeader>
              <TableColumnHeader style={{ width: "14%" }}>
                Date Created
              </TableColumnHeader>
              <TableColumnHeader style={{ width: "14%" }}>
                Date Updated
              </TableColumnHeader>
              <TableColumnHeader style={{ width: 50 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectList.map((p) => {
              const canEdit = permissionsUtil.canUpdateProject(p.id);
              const canDelete =
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
                  style={canEdit ? { cursor: "pointer" } : undefined}
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
                      <Box>
                        <Badge
                          label={`Managed by ${capitalizeFirstLetter(
                            p.managedBy.type,
                          )}`}
                        />
                      </Box>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="pr-5"
                    style={{
                      fontSize: 12,
                      color: "var(--gray-11)",
                    }}
                  >
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
                          type="button"
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p>Click the button in the top right to create your first project!</p>
      )}
    </Box>
  );
};
export default ProjectsPage;
