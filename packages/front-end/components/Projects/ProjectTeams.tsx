import { FC, useState } from "react";
import { useRouter } from "next/router";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  MemberRoleWithProjects,
  ProjectMemberRole,
} from "shared/types/organization";
import { isProjectScopedTeam } from "shared/permissions";
import { Team, useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ChangeProjectRoleModal from "@/components/Settings/Team/ChangeProjectRoleModal";
import { AddMembersModal } from "@/components/Teams/AddMembersModal";
import { RoleRuleLines } from "@/components/Settings/Team/RoleRuleLabel";
import ProjectRuleFields from "@/components/Settings/Team/ProjectRuleFields";
import { MEMBER_COLUMN_WIDTHS } from "@/components/Settings/Team/memberTableWidths";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import Button from "@/ui/Button";
import TextField from "@/ui/TextField";
import Field from "@/components/Forms/Field";
import { Select, SelectItem } from "@/ui/Select";
import Tooltip from "@/ui/Tooltip";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";

// The team's role fields, as PUT /teams/:id expects them.
const teamRoleInfo = (team: Team): MemberRoleWithProjects => ({
  role: team.role,
  limitAccessByEnvironment: team.limitAccessByEnvironment,
  environments: team.environments,
  additionalRoles: team.additionalRoles || [],
  projectRoles: team.projectRoles || [],
});

const rulesWithoutProject = (team: Team, project: string) =>
  (team.projectRoles || []).filter((rule) => rule.project !== project);

const newRule = (project: string): ProjectMemberRole => ({
  project,
  role: "collaborator",
  limitAccessByEnvironment: false,
  environments: [],
});

const noGlobalRole = {
  role: "noaccess",
  limitAccessByEnvironment: false,
  environments: [],
  additionalRoles: [],
};

// One modal for both ways a team gains a role here: a brand-new project-scoped
// team, or an existing team that doesn't have a rule on this Project yet.
const ProjectTeamRuleModal: FC<{
  project: string;
  mode: "create" | "add";
  candidates: Team[];
  close: () => void;
  onSuccess: () => void;
}> = ({ project, mode, candidates, close, onSuccess }) => {
  const { apiCall } = useAuth();
  const { getProjectById } = useDefinitions();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState(candidates[0]?.id || "");
  const [rule, setRule] = useState(newRule(project));

  const team = candidates.find((t) => t.id === teamId);
  const projectName = getProjectById(project)?.name ?? project;

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      size="lg"
      header={mode === "create" ? "Create Project Team" : "Add Team to Project"}
      subheader={
        mode === "create" ? (
          <>
            Members of this team get a role on <strong>{projectName}</strong>{" "}
            and nothing else. It has no global role.
          </>
        ) : (
          <>
            Give an existing team a role on <strong>{projectName}</strong>.
          </>
        )
      }
      ctaEnabled={mode === "create" ? !!name.trim() : !!team}
      submit={async () => {
        if (mode === "create") {
          await apiCall("/teams", {
            method: "POST",
            body: JSON.stringify({
              name: name.trim(),
              description,
              permissions: { ...noGlobalRole, projectRoles: [rule] },
              defaultProject: project,
            }),
          });
        } else if (team) {
          await apiCall(`/teams/${team.id}`, {
            method: "PUT",
            body: JSON.stringify({
              permissions: {
                ...teamRoleInfo(team),
                projectRoles: [...rulesWithoutProject(team, project), rule],
              },
            }),
          });
        }
        onSuccess();
      }}
    >
      {mode === "create" ? (
        <>
          <TextField
            label="Name"
            maxLength={30}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            mb="3"
          />
          <Field
            label="Description"
            maxLength={100}
            minRows={1}
            maxRows={4}
            textarea={true}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </>
      ) : (
        <Box mb="3">
          <Select label="Team" value={teamId} setValue={setTeamId}>
            {candidates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </Select>
        </Box>
      )}
      <ProjectRuleFields rule={rule} setRule={setRule} />
    </ModalStandard>
  );
};

const TeamMembersModal: FC<{
  team: Team;
  canRemove: (memberId: string) => boolean;
  close: () => void;
  onChange: () => void;
}> = ({ team, canRemove, close, onChange }) => {
  const { apiCall } = useAuth();
  const members = team.members || [];

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={`${team.name} Members`}
      closeCta="Close"
    >
      <Table variant="surface">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell>{member.name}</TableCell>
              <TableCell>{member.email}</TableCell>
              <TableCell justify="end">
                {canRemove(member.id) && (
                  <DeleteButton
                    displayName="member"
                    text="Remove"
                    cta="Remove"
                    title={`Remove ${member.email} from ${team.name}`}
                    link
                    useIcon={false}
                    deleteMessage={`${member.email} will lose this team's roles.`}
                    onClick={async () => {
                      await apiCall(`/teams/${team.id}/member/${member.id}`, {
                        method: "DELETE",
                      });
                      onChange();
                    }}
                  />
                )}
              </TableCell>
            </TableRow>
          ))}
          {members.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} style={{ textAlign: "center" }}>
                <Text color="text-mid">This team has no members yet.</Text>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </ModalStandard>
  );
};

// Teams as seen from one project. The page owns a team's rule for THIS project;
// whole-team actions (members, deletion) reach every project the team touches
// and are offered only when the viewer administers all of them; a team's
// global role is never edited here.
const ProjectTeams: FC<{ project: string }> = ({ project }) => {
  const {
    teams = [],
    organization,
    userId,
    refreshOrganization,
    hasCommercialFeature,
  } = useUser();
  const { getProjectById } = useDefinitions();
  const { apiCall } = useAuth();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const canManageTeam = permissionsUtil.canManageTeam();

  const [ruleModal, setRuleModal] = useState<"create" | "add" | null>(null);
  const [roleTeamId, setRoleTeamId] = useState<string | null>(null);
  const [membersTeamId, setMembersTeamId] = useState<string | null>(null);
  const [addMembersTeamId, setAddMembersTeamId] = useState<string | null>(null);

  const byName = (a: Team, b: Team) => a.name.localeCompare(b.name);
  const rows = teams
    .filter((t) => t.projectRoles?.some((rule) => rule.project === project))
    .sort(byName);
  const addCandidates = teams
    .filter(
      (t) =>
        !t.projectRoles?.some((rule) => rule.project === project) &&
        permissionsUtil.canUpdateTeam(t, {
          projectRoles: [...(t.projectRoles || []), newRule(project)],
        }),
    )
    .sort(byName);
  const canCreate = permissionsUtil.canCreateTeam({
    ...noGlobalRole,
    projectRoles: [newRule(project)],
  });

  const roleTeam = teams.find((t) => t.id === roleTeamId);
  const membersTeam = teams.find((t) => t.id === membersTeamId);

  const saveRules = async (team: Team, projectRoles: ProjectMemberRole[]) => {
    await apiCall(`/teams/${team.id}`, {
      method: "PUT",
      body: JSON.stringify({
        permissions: { ...teamRoleInfo(team), projectRoles },
      }),
    });
    refreshOrganization();
  };

  // Whole-team actions on the confined path exclude the viewer, mirroring the
  // rule for members' own project roles.
  const canTouchMember = (memberId: string) =>
    canManageTeam || memberId !== userId;

  if (!hasCommercialFeature("teams")) {
    return (
      <Box mb="4">
        <Heading as="h5" size="sm" mb="2">
          Teams
        </Heading>
        <PremiumEmptyState
          title="Teams"
          description="Give a group of users a role on this Project in one step, and manage the group here."
          commercialFeature="teams"
          learnMoreLink="https://docs.growthbook.io/account/user-permissions#project-scoped-teams"
        />
      </Box>
    );
  }

  return (
    <Box mb="4">
      {ruleModal && (
        <ProjectTeamRuleModal
          project={project}
          mode={ruleModal}
          candidates={addCandidates}
          close={() => setRuleModal(null)}
          onSuccess={() => {
            refreshOrganization();
            setRuleModal(null);
          }}
        />
      )}
      {roleTeam && (
        <ChangeProjectRoleModal
          memberName={roleTeam.name}
          projectRole={
            roleTeam.projectRoles?.find((rule) => rule.project === project) ||
            newRule(project)
          }
          close={() => setRoleTeamId(null)}
          onConfirm={async (rule) => {
            await saveRules(roleTeam, [
              ...rulesWithoutProject(roleTeam, project),
              rule,
            ]);
          }}
        />
      )}
      {membersTeam && (
        <TeamMembersModal
          team={membersTeam}
          canRemove={canTouchMember}
          close={() => setMembersTeamId(null)}
          onChange={() => refreshOrganization()}
        />
      )}
      {addMembersTeamId && (
        <AddMembersModal
          teamId={addMembersTeamId}
          open={true}
          onClose={() => setAddMembersTeamId(null)}
        />
      )}

      <Flex align="center" justify="between" gap="3" mb="2">
        <Heading as="h5" size="sm" mb="0">
          Teams ({rows.length})
        </Heading>
        <Flex align="center" gap="3">
          {teams.length > rows.length && (
            <Tooltip
              enabled={!addCandidates.length}
              content="The remaining teams carry a global role or are managed externally, so adding them here needs Team Management."
            >
              <Button
                variant="outline"
                disabled={!addCandidates.length}
                onClick={() => setRuleModal("add")}
              >
                Add existing team
              </Button>
            </Tooltip>
          )}
          {canCreate && (
            <Button onClick={() => setRuleModal("create")}>Create team</Button>
          )}
        </Flex>
      </Flex>
      <Text as="p" size="sm" color="text-low" mb="2">
        Every member of a team gets the team&apos;s role on this Project, which
        replaces their global role here.
      </Text>
      <Table variant="surface" layout="fixed">
        <TableHeader>
          <TableRow>
            <TableColumnHeader width="30%">Team</TableColumnHeader>
            <TableColumnHeader width="20%">Global role</TableColumnHeader>
            <TableColumnHeader width="30%">
              Role on this Project
            </TableColumnHeader>
            <TableColumnHeader width="10%">Members</TableColumnHeader>
            <TableColumnHeader width={MEMBER_COLUMN_WIDTHS.actions} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((team) => {
            const rule = team.projectRoles?.find((r) => r.project === project);
            const otherProjects = rulesWithoutProject(team, project).map(
              (r) => getProjectById(r.project)?.name ?? r.project,
            );
            const externallyManaged = !!(
              team.managedBy?.type || team.managedByIdp
            );
            const canEditRule = permissionsUtil.canUpdateTeam(team, {
              projectRoles: rulesWithoutProject(team, project),
            });
            const canManageMembers =
              !externallyManaged &&
              permissionsUtil.canManageTeamMembership(team);

            return (
              <TableRow key={team.id}>
                <TableCell>
                  {canManageTeam ? (
                    <Link href={`/settings/team/${team.id}`}>{team.name}</Link>
                  ) : (
                    team.name
                  )}
                  {otherProjects.length > 0 && (
                    <div>
                      <Tooltip
                        content={
                          canManageMembers
                            ? "Members of this team also get its role on these Projects."
                            : "Managing this team's members needs Project Admin on every Project it covers."
                        }
                      >
                        <Text size="sm" color="text-low">
                          Also grants roles on {otherProjects.join(", ")}
                        </Text>
                      </Tooltip>
                    </div>
                  )}
                  {!isProjectScopedTeam(team) && !canManageTeam && (
                    <div>
                      <Text size="sm" color="text-low">
                        Has a global role; managed by Team Management
                      </Text>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <RoleRuleLines scope={team} organization={organization} />
                </TableCell>
                <TableCell>
                  {rule && (
                    <RoleRuleLines scope={rule} organization={organization} />
                  )}
                </TableCell>
                <TableCell>{team.members?.length ?? 0}</TableCell>
                <TableCell justify="end">
                  {canEditRule && (
                    <DropdownMenu
                      trigger={
                        <IconButton
                          variant="ghost"
                          color="gray"
                          radius="full"
                          size="2"
                          highContrast
                          aria-label="Team actions"
                        >
                          <BsThreeDotsVertical size={18} />
                        </IconButton>
                      }
                      menuPlacement="end"
                      variant="soft"
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() => setRoleTeamId(team.id)}
                        >
                          Change role on this Project
                        </DropdownMenuItem>
                        {canManageMembers && (
                          <>
                            <DropdownMenuItem
                              onClick={() => setMembersTeamId(team.id)}
                            >
                              View members
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setAddMembersTeamId(team.id)}
                            >
                              Add members
                            </DropdownMenuItem>
                          </>
                        )}
                        {canManageTeam && (
                          <DropdownMenuItem
                            onClick={() => {
                              router.push(`/settings/team/${team.id}`);
                            }}
                          >
                            Team settings
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          color="red"
                          confirmation={{
                            submit: async () => {
                              await saveRules(
                                team,
                                rulesWithoutProject(team, project),
                              );
                            },
                            confirmationTitle: "Remove team from Project",
                            cta: "Remove",
                            getConfirmationContent: async () =>
                              `Members of "${team.name}" will lose the team's role on this Project. The team itself is kept.`,
                          }}
                        >
                          Remove from this Project
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} style={{ textAlign: "center" }}>
                <Text color="text-mid">
                  No teams have a role on this Project yet.
                </Text>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  );
};

export default ProjectTeams;
