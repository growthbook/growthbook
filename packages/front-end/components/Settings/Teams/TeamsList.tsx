import { FC } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { date } from "shared/dates";
import { FaCheck, FaTimes } from "react-icons/fa";
import { RxIdCard } from "react-icons/rx";
import { useUser } from "@front-end/services/UserContext";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import ProjectBadges from "@front-end/components/ProjectBadges";
import DeleteButton from "@front-end/components/DeleteButton/DeleteButton";
import { useEnvironments } from "@front-end/services/features";
import { roleHasAccessToEnv, useAuth } from "@front-end/services/auth";
import usePermissions from "@front-end/hooks/usePermissions";
import Tooltip from "@front-end/components/Tooltip/Tooltip";

const TeamsList: FC = () => {
  const { teams, refreshOrganization } = useUser();
  const { projects } = useDefinitions();
  const router = useRouter();
  const environments = useEnvironments();
  const { apiCall } = useAuth();
  const permissions = usePermissions();
  const canManageTeam = permissions.check("manageTeam");

  return (
    <div className="mb-4">
      <div>
        {teams && teams.length > 0 ? (
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <th className="col-2">Team Name</th>
                <th className="col-3">Description</th>
                <th className="col-2">Date Updated</th>
                <th className="col-2">Global Role</th>
                <th className="col-2">Project Roles</th>
                {environments.map((env) => (
                  <th key={env.id}>{env.id}</th>
                ))}
                <th className="col-1">Members</th>
                <th className="w-50" />
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                return (
                  <tr
                    key={t.id}
                    onClick={() => {
                      router.push(`/settings/team/${t.id}`);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      {
                        <Link
                          href={`/settings/team/${t.id}`}
                          className="font-weight-bold"
                        >
                          {t.name}
                        </Link>
                      }
                    </td>
                    <td className="pr-5 text-gray" style={{ fontSize: 12 }}>
                      {t.description}
                    </td>
                    <td>{date(t.dateUpdated)}</td>
                    <td>{t.role}</td>
                    <td>
                      {t.projectRoles &&
                        t.projectRoles.map((pr) => {
                          const p = projects.find((p) => p.id === pr.project);
                          if (p?.name) {
                            return (
                              <div key={`project-tags-${p.id}`}>
                                <ProjectBadges
                                  resourceType="team"
                                  projectIds={[p.id]}
                                  className="badge-ellipsis short align-middle font-weight-normal"
                                />{" "}
                                — {pr.role}
                              </div>
                            );
                          }
                          return null;
                        })}
                    </td>
                    {environments.map((env) => {
                      const access = roleHasAccessToEnv(t, env.id);
                      return (
                        <td key={env.id}>
                          {access === "N/A" ? (
                            <span className="text-muted">N/A</span>
                          ) : access === "yes" ? (
                            <FaCheck className="text-success" />
                          ) : (
                            <FaTimes className="text-danger" />
                          )}
                        </td>
                      );
                    })}
                    <td>{t.members ? t.members.length : 0}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {(canManageTeam && !t.managedByIdp && (
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p>Click the button in the top right to create your first team!</p>
        )}
      </div>
    </div>
  );
};

export default TeamsList;
