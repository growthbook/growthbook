import { FC } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { date } from "shared/dates";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";

const TeamsList: FC = () => {
  const { teams } = useUser();
  const { projects } = useDefinitions();
  const router = useRouter();

  return (
    <div className="my-4">
      <p>
        Place organization members into teams to grant permissions by group.
      </p>
      <div>
        {teams.length > 0 ? (
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <th className="col-2">Team Name</th>
                <th className="col-3">Description</th>
                <th className="col-2">Date Updated</th>
                <th className="col-2">Global Role</th>
                <th className="col-2">Project Roles</th>
                <th className="col-1">Members</th>
                <th className="w-50"></th>
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
                        <Link href={`/settings/team/${t.id}`}>
                          <a className="font-weight-bold">{t.name}</a>
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
                                  projectIds={[p.id]}
                                  className="badge-ellipsis align-middle font-weight-normal"
                                />{" "}
                                — {pr.role}
                              </div>
                            );
                          }
                          return null;
                        })}
                    </td>
                    <td>{t.members ? t.members.length : 0}</td>
                    <td
                      style={{ cursor: "initial" }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    ></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p>Click the button in the top right to create your first project!</p>
        )}
      </div>
    </div>
  );
};

export default TeamsList;
