import { FC, useState } from "react";
import { FaUsers } from "react-icons/fa";
import usePermissions from "@/hooks/usePermissions";
import TeamsList from "@/components/Settings/Teams/TeamsList";
import TeamModal from "@/components/Teams/TeamModal";
import { Team, useUser } from "@/services/UserContext";
import Tabs from "@/components/Tabs/Tabs";
import Tab from "@/components/Tabs/Tab";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { MembersTabView } from "@/components/Settings/Team/MembersTabView";

const TeamPage: FC = () => {
  const { refreshOrganization, hasCommercialFeature } = useUser();
  const permissions = usePermissions();
  const [modalOpen, setModalOpen] = useState<Partial<Team> | null>(null);
  const hasTeamsFeature = hasCommercialFeature("teams");

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
      <Tabs defaultTab="members" newStyle={true}>
        <Tab anchor="members" id="members" display="Members" padding={false}>
          <MembersTabView />
        </Tab>
        <Tab anchor="teams" id="teams" display="Teams" padding={false} lazy>
          {modalOpen && (
            <TeamModal
              existing={modalOpen}
              close={() => setModalOpen(null)}
              onSuccess={() => refreshOrganization()}
            />
          )}
          <div className="filters md-form row mb-1 align-items-center">
            <div className="col-auto d-flex align-items-end">
              <div>
                <h1>
                  <PremiumTooltip commercialFeature="teams">
                    Teams
                  </PremiumTooltip>
                </h1>
                <div className="text-muted mb-2">
                  Place organization members into teams to grant permissions by
                  group.
                </div>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div className="col-auto">
              <button
                className="btn btn-primary"
                disabled={!hasTeamsFeature}
                onClick={(e) => {
                  e.preventDefault();
                  setModalOpen({});
                }}
              >
                <FaUsers /> <span> </span>Create Team
              </button>
            </div>
          </div>
          {hasTeamsFeature ? (
            <TeamsList />
          ) : (
            <div className="alert alert-warning">
              Teams are only available on the Enterprise plan. Email
              sales@growthbook.io for more information and to set up a call.
            </div>
          )}
        </Tab>
      </Tabs>
    </div>
  );
};
export default TeamPage;
