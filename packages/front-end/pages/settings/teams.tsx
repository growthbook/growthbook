import { FC, useState } from "react";
import { FaUsers } from "react-icons/fa";
import { TeamInterface } from "back-end/types/team";
import usePermissions from "@/hooks/usePermissions";
import TeamsList from "@/components/Settings/Teams/TeamsList";
import TeamModal from "@/components/Teams/TeamModal";
import { useUser } from "@/services/UserContext";

const TeamPage: FC = () => {
  const { refreshTeams } = useUser();
  const permissions = usePermissions();
  const [modalOpen, setModalOpen] = useState<Partial<TeamInterface> | null>(
    null
  );

  if (!permissions.manageTeam) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <>
      {modalOpen && (
        <TeamModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => refreshTeams()}
        />
      )}
      <div className="container-fluid pagecontents">
        <div className="filters md-form row mb-3 align-items-center">
          <div className="col-auto d-flex">
            <h1>Teams</h1>
          </div>
          <div style={{ flex: 1 }} />
          <div className="col-auto">
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen({});
              }}
            >
              <FaUsers /> <span> </span>Create Team
            </button>
          </div>
        </div>
        <TeamsList />
      </div>
    </>
  );
};
export default TeamPage;
