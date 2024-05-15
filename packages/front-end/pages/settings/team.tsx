import { FC, useState } from "react";
import { FaUsers, FaPlusCircle } from "react-icons/fa";
import Link from "next/link";
import TeamsList from "@/components/Settings/Teams/TeamsList";
import TeamModal from "@/components/Teams/TeamModal";
import { Team, useUser } from "@/services/UserContext";
import Tabs from "@/components/Tabs/Tabs";
import Tab from "@/components/Tabs/Tab";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { MembersTabView } from "@/components/Settings/Team/MembersTabView";
import RoleList from "@/components/Teams/Roles/RoleList";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const TeamPage: FC = () => {
  const { refreshOrganization, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [modalOpen, setModalOpen] = useState<Partial<Team> | null>(null);
  const hasTeamsFeature = hasCommercialFeature("teams");
  const hasCustomRolesFeature = hasCommercialFeature("custom-roles");

  if (!permissionsUtil.canManageTeam()) {
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
        <Tab anchor="roles" id="roles" display="Roles" padding={false} lazy>
          <div className="filters md-form row mb-1 align-items-center">
            <div className="col-auto d-flex align-items-end">
              <div>
                <h1>
                  <PremiumTooltip commercialFeature="custom-roles">
                    Roles
                  </PremiumTooltip>
                </h1>
                <div className="text-muted mb-2">
                  Create and update roles to customize permissions for your
                  organization&apos;s users and teams.
                </div>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div className="col-auto">
              <Link href="/settings/role/new" className="btn btn-primary">
                <FaPlusCircle /> <span> </span>Create Custom Role
              </Link>
            </div>
          </div>
          {hasCustomRolesFeature ? (
            <RoleList />
          ) : (
            <div className="alert alert-warning">
              Custom Roles are only available on the Enterprise plan. Email
              sales@growthbook.io for more information and to set up a call.
            </div>
          )}
        </Tab>
      </Tabs>
    </div>
  );
};
export default TeamPage;
