import { FC, useState } from "react";
import TeamsList from "@/components/Settings/Teams/TeamsList";
import TeamModal from "@/components/Teams/TeamModal";
import { Team, useUser } from "@/services/UserContext";
import Tabs from "@/components/Radix/Tabs";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { MembersTabView } from "@/components/Settings/Team/MembersTabView";
import RoleList from "@/components/Teams/Roles/RoleList";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/components/Radix/Button";
import LinkButton from "@/components/Radix/LinkButton";

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

  const tabs = [
    {
      slug: "members",
      label: "Members",
      content: <MembersTabView />,
    },
    {
      slug: "teams",
      label: <PremiumTooltip commercialFeature="teams">Teams</PremiumTooltip>,
      content: (
        <>
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
              <Button
                disabled={!hasTeamsFeature}
                onClick={() => setModalOpen({})}
              >
                Create Team
              </Button>
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
        </>
      ),
    },
    {
      slug: "roles",
      label: (
        <PremiumTooltip commercialFeature="custom-roles">Roles</PremiumTooltip>
      ),
      content: (
        <>
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
              {hasCustomRolesFeature ? (
                <LinkButton href="/settings/role/new">
                  Create Custom Role
                </LinkButton>
              ) : null}
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
        </>
      ),
    },
  ];

  return (
    <div className="container-fluid pagecontents">
      <Tabs defaultTabSlug="members" tabs={tabs} />
    </div>
  );
};
export default TeamPage;
