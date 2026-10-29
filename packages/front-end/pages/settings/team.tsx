import { FC, useState } from "react";
import { Box } from "@radix-ui/themes";
import TeamsList from "@/components/Settings/Teams/TeamsList";
import TeamModal from "@/components/Teams/TeamModal";
import { Team, useUser } from "@/services/UserContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { MembersTabView } from "@/components/Settings/Team/MembersTabView";
import RoleList from "@/components/Teams/Roles/RoleList";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import SettingsPage, {
  SettingsNoAccess,
  SettingsPageHeader,
} from "@/components/Layout/SettingsPage";

const TeamPage: FC = () => {
  const { refreshOrganization, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [modalOpen, setModalOpen] = useState<Partial<Team> | null>(null);
  const hasTeamsFeature = hasCommercialFeature("teams");
  const hasCustomRolesFeature = hasCommercialFeature("custom-roles");

  if (!permissionsUtil.canManageTeam()) {
    return <SettingsNoAccess title="Members" />;
  }

  return (
    <SettingsPage title="Members">
      <Tabs defaultValue="members" persistInURL>
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
            <SettingsPageHeader
              as="h2"
              title={
                <PremiumTooltip commercialFeature="teams">Teams</PremiumTooltip>
              }
              description="Place organization members into teams to grant permissions by group."
              actions={
                <Button
                  disabled={!hasTeamsFeature}
                  onClick={() => setModalOpen({})}
                >
                  Create team
                </Button>
              }
            />
            {hasTeamsFeature ? (
              <TeamsList
                onDuplicate={(team) =>
                  setModalOpen({
                    name: `${team.name} (copy)`,
                    description: team.description,
                    role: team.role,
                    limitAccessByEnvironment: team.limitAccessByEnvironment,
                    environments: team.environments,
                    additionalRoles: team.additionalRoles,
                    projectRoles: team.projectRoles,
                    defaultProject: team.defaultProject,
                  })
                }
              />
            ) : (
              <PremiumEmptyState
                title="Teams"
                description="Create groups of GrowthBook users to organize and manage permissions centrally"
                commercialFeature="teams"
                learnMoreLink="https://docs.growthbook.io/account/user-permissions#teams"
              />
            )}
          </>
        </TabsContent>

        <TabsContent value="roles">
          <>
            <SettingsPageHeader
              as="h2"
              title={
                <PremiumTooltip commercialFeature="custom-roles">
                  Roles
                </PremiumTooltip>
              }
              description="Create and update roles to customize permissions for your organization's users and teams."
              actions={
                hasCustomRolesFeature ? (
                  <LinkButton href="/settings/role/new">
                    Create custom role
                  </LinkButton>
                ) : null
              }
            />
            {hasCustomRolesFeature ? (
              <RoleList />
            ) : (
              <PremiumEmptyState
                title="Custom Roles"
                description="Custom roles allows you to adjust permissions and assign those roles to members or teams"
                commercialFeature="custom-roles"
                learnMoreLink="https://docs.growthbook.io/account/user-permissions#custom-roles"
              />
            )}
          </>
        </TabsContent>
      </Tabs>
    </SettingsPage>
  );
};
export default TeamPage;
