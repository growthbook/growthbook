import React, { FC } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { date } from "shared/dates";
import { FaCheck, FaTimes } from "react-icons/fa";
import { RxIdCard } from "react-icons/rx";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useEnvironments } from "@/services/features";
import { roleHasAccessToEnv, useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import { capitalizeFirstLetter } from "@/services/utils";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

const TeamsList: FC = () => {
  const { teams, refreshOrganization, organization } = useUser();
  const { projects } = useDefinitions();
  const router = useRouter();
  const environments = useEnvironments();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canManageTeam = permissionsUtil.canManageTeam();

  return (
    <div className="mb-4">
      <div style={{ overflowX: "auto" }}>
        {teams && teams.length > 0 ? (
          <Table variant="standard" hover className="appbox">
            <TableHeader>
              <TableRow>
                <TableColumnHeader className="col-2">Team Name</TableColumnHeader>
                <TableColumnHeader className="col-3">Description</TableColumnHeader>
                <TableColumnHeader className="col-2">Date Updated</TableColumnHeader>
                <TableColumnHeader className="col-2">Global Role</TableColumnHeader>
                <TableColumnHeader className="col-2">Project Roles</TableColumnHeader>
                {environments.map((env) => (
                  <TableColumnHeader key={env.id}>{env.id}</TableColumnHeader>
                ))}
                <TableColumnHeader className="col-1">Members</TableColumnHeader>
                <TableColumnHeader className="w-50" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((t) => {
                const teamIsExternallyManaged =
                  t.managedBy?.type || t.managedByIdp;
                return (
                  <TableRow
                    key={t.id}
                    onClick={() => {
                      router.push(`/settings/team/${t.id}`);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      {
                        <Link
                          href={`/settings/team/${t.id}`}
                          className="font-weight-bold"
                        >
                          {t.name}
                        </Link>
                      }
                      {t.managedBy?.type ? (
                        <div>
                          <Badge
                            label={`Managed by ${capitalizeFirstLetter(
                              t.managedBy.type,
                            )}`}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="pr-5 text-gray" style={{ fontSize: 12 }}>
                      {t.description}
                    </TableCell>
                    <TableCell>{date(t.dateUpdated)}</TableCell>
                    <TableCell>{t.role}</TableCell>
                    <TableCell>
                      {t.projectRoles &&
                        t.projectRoles.map((pr) => {
                          const p = projects.find((p) => p.id === pr.project);
                          if (p?.name) {
                            return (
                              <div key={`project-tags-${p.id}`}>
                                <ProjectBadges
                                  resourceType="team"
                                  projectIds={[p.id]}
                                />{" "}
                                — {pr.role}
                              </div>
                            );
                          }
                          return null;
                        })}
                    </TableCell>
                    {environments.map((env) => {
                      const access = roleHasAccessToEnv(
                        t,
                        env.id,
                        organization,
                      );
                      return (
                        <TableCell key={env.id}>
                          {access === "N/A" ? (
                            <span className="text-muted">N/A</span>
                          ) : access === "yes" ? (
                            <FaCheck className="text-success" />
                          ) : (
                            <FaTimes className="text-danger" />
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell>{t.members ? t.members.length : 0}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {(canManageTeam && !teamIsExternallyManaged && (
                        <>
                          <DeleteButton
                            link={true}
                            useIcon={true}
                            displayName={t.name}
                            onClick={async () => {
                              await apiCall(`/teams/${t.id}`, {
                                method: "DELETE",
                              });
                              refreshOrganization();
                            }}
                          />
                        </>
                      )) || (
                        <Tooltip
                          className="mr-2"
                          body="This team is managed by an external identity provider."
                        >
                          <RxIdCard className="text-blue" />
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p>Click the button in the top right to create your first team!</p>
        )}
      </div>
    </div>
  );
};

export default TeamsList;
