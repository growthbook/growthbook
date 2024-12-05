import { FC, useState } from "react";
import { Box } from "@radix-ui/themes";
import TeamsList from "@/components/Settings/Teams/TeamsList";
import TeamModal from "@/components/Teams/TeamModal";
import { Team, useUser } from "@/services/UserContext";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/Radix/Tabs";
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

  return (
    <div className="container-fluid pagecontents">
      <Tabs defaultValue="members">
        <Box mb="5">
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="teams">Teams</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
          </TabsList>
        </Box>

        <TabsContent value="members">
          <MembersTabView />
        </TabsContent>

        <TabsContent value="teams">
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
                    Place organization members into teams to grant permissions
                    by group.
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
        </TabsContent>

        <TabsContent value="roles">
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
        </TabsContent>
      </Tabs>
    </div>
  );
};
export default TeamPage;
