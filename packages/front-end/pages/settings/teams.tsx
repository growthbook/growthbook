import { FC } from "react";
import usePermissions from "@/hooks/usePermissions";
import TeamsList from "@/components/Settings/Teams/TeamsList";

const TeamPage: FC = () => {
  const permissions = usePermissions();

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
    <div className="container-fluid pagecontents">
      <h1>Teams</h1>
      <TeamsList />
    </div>
  );
};
export default TeamPage;
