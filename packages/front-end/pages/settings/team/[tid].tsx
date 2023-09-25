import router from "next/router";
import { FC, useState } from "react";
import { TeamInterface } from "back-end/types/team";
import { datetime } from "shared/dates";
import Link from "next/link";
import { MemberRole } from "back-end/types/organization";
// import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import usePermissions from "@/hooks/usePermissions";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { GBAddCircle, GBCircleArrowLeft, GBEdit } from "@/components/Icons";
import RoleSelector from "@/components/Settings/Team/RoleSelector";
import TeamModal from "@/components/Teams/TeamModal";
import useApi from "@/hooks/useApi";

const TeamPage: FC = () => {
  //const { apiCall } = useAuth();
  const { tid } = router.query as { tid: string };
  // const [loading, setLoading] = useState<boolean>(false);
  const [newTeam, setNewTeam] = useState<Partial<TeamInterface> | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  const permissions = usePermissions();
  const canManageTeam = permissions.check("manageTeam");

  console.log({ newTeam });

  const { data } = useApi<{
    team: TeamInterface;
  }>(`/teams/${tid}`);

  console.log({ data });

  if (!data) {
    return <LoadingOverlay />;
  }

  //   if (!data) {
  //     return (
  //       <div className="container pagecontents">
  //         <div className="alert alert-danger">
  //           Team <code>{tid}</code> does not exist.
  //         </div>
  //       </div>
  //     );
  //   }

  const { team } = data;

  return (
    <>
      {modalOpen && (
        <TeamModal
          existing={team}
          close={() => setModalOpen(false)}
          onSuccess={() => new Promise(() => undefined)}
        />
      )}
      <div className="container pagecontents">
        <div className="mb-2">
          <Link href="/settings/teams">
            <a>
              <GBCircleArrowLeft /> Back to all teams
            </a>
          </Link>
        </div>
        <div className="d-flex align-items-center mb-2">
          <h1 className="mb-0">{team.name}</h1>
          <div className="ml-1">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(true);
              }}
            >
              <GBEdit />
            </a>
          </div>
        </div>
        <div className="d-flex align-items-center mb-2">
          <div className="text-gray">
            {team.description || <em>add description</em>}
          </div>
          <div className="ml-1">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(true);
              }}
            >
              <GBEdit />
            </a>
          </div>
        </div>

        <div className="d-flex align-center">
          <h2 className="mt-4 mb-4 mr-2">Team Members</h2>
          <span
            className="h4 pr-2 align-self-center"
            role="button"
            onClick={() => undefined}
          >
            <GBAddCircle />
          </span>
        </div>

        <div className="mb-4">
          <h5>
            Active Members
            {` (${team.members ? team.members.length : 0})`}
          </h5>
          <table className="table appbox gbtable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Date Joined</th>
                <th style={{ width: 50 }} />
              </tr>
            </thead>
            <tbody>
              {team.members?.map((member) => {
                return (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>{member.email}</td>
                    <td>
                      {member.dateCreated && datetime(member.dateCreated)}
                    </td>
                    <td>
                      {canManageTeam && (
                        <>
                          <DeleteButton
                            link={true}
                            useIcon={true}
                            displayName={member.email}
                            onClick={() => {
                              //   await apiCall(`/member/${member.id}`, {
                              //     method: "DELETE",
                              //   });
                              // mutate();
                            }}
                          />
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h2 className="mt-4 mb-4">Team Settings</h2>
        <div className="row">
          <div className="col-sm-6">
            <div className="bg-white p-3 border">
              <RoleSelector
                value={{
                  environments: team.environments || [],
                  limitAccessByEnvironment: !!team.limitAccessByEnvironment,
                  role: team.role as MemberRole,
                  projectRoles: team.projectRoles,
                }}
                setValue={setNewTeam}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default TeamPage;
