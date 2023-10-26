import { FC, useState } from "react";
import { FaUsers } from "react-icons/fa";
import { TeamInterface } from "back-end/types/team";
import usePermissions from "@/hooks/usePermissions";
import TeamsList from "@/components/Settings/Teams/TeamsList";
import TeamModal from "@/components/Teams/TeamModal";
import { useUser } from "@/services/UserContext";
import Tabs from "@/components/Tabs/Tabs";
import Tab from "@/components/Tabs/Tab";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import MembersPage from "./members";

const TeamPage: FC = () => {
  const [upgradeModal, setUpgradeModal] = useState(false);
  const { refreshTeams, hasCommercialFeature } = useUser();
  const permissions = usePermissions();
  const [modalOpen, setModalOpen] = useState<Partial<TeamInterface> | null>(
    null
  );
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

  if (upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        reason="To manage user permissions through teams,"
        source="teams"
      />
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <Tabs defaultTab="members" newStyle={true}>
        <Tab anchor="members" id="members" display="Members" padding={false}>
          <MembersPage />
        </Tab>
        <Tab anchor="teams" id="teams" display="Teams" padding={false} lazy>
          {modalOpen && (
            <TeamModal
              existing={modalOpen}
              close={() => setModalOpen(null)}
              onSuccess={() => refreshTeams()}
            />
          )}
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col-auto d-flex">
              <h1>
                <PremiumTooltip commercialFeature="teams">Teams</PremiumTooltip>
              </h1>
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
            {!hasTeamsFeature && (
              <UpgradeMessage
                className="mt-2"
                showUpgradeModal={() => setUpgradeModal(true)}
                commercialFeature="teams"
                upgradeMessage="manage user permissions through teams"
              />
            )}
          </div>
          {hasTeamsFeature && <TeamsList />}
        </Tab>
      </Tabs>
    </div>
  );
};
export default TeamPage;
