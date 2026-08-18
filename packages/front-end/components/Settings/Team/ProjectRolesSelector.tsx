import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ProjectMemberRole } from "shared/types/organization";
import { getDefaultRole } from "shared/permissions";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import SingleRoleSelector from "./SingleRoleSelector";

export default function ProjectRolesSelector({
  projectRoles,
  setProjectRoles,
}: {
  projectRoles: ProjectMemberRole[];
  setProjectRoles: (roles: ProjectMemberRole[]) => void;
}) {
  const { projects, getProjectById } = useDefinitions();
  const { hasCommercialFeature, organization } = useUser();
  const [newProject, setNewProject] = useState("");

  const defaultRole = getDefaultRole(organization);

  const hasFeature = hasCommercialFeature("advanced-permissions");
  if (!projects?.length) return null;

  const usedProjectIds = projectRoles.map((r) => r.project);
  const unusedProjects = projects.filter((p) => !usedProjectIds.includes(p.id));

  return (
    <>
      <Text as="label" weight="semibold" mb="2">
        <PremiumTooltip commercialFeature="advanced-permissions">
          Project Roles (optional)
        </PremiumTooltip>
      </Text>
      {projectRoles.map((projectRole, i) => (
        <div className="appbox px-3 pt-2 bg-light" key={i}>
          <Flex justify="between" align="start" gap="3">
            <Box flexGrow="1">
              <SingleRoleSelector
                value={{
                  role: projectRole.role,
                  environments: projectRole.environments,
                  limitAccessByEnvironment:
                    projectRole.limitAccessByEnvironment,
                }}
                setValue={(newRoleInfo) => {
                  const newProjectRoles = [...projectRoles];
                  newProjectRoles[i] = {
                    ...projectRole,
                    ...newRoleInfo,
                  };
                  setProjectRoles(newProjectRoles);
                }}
                label={
                  <>
                    Project:{" "}
                    <strong>{getProjectById(projectRole.project)?.name}</strong>
                  </>
                }
                disabled={!hasFeature}
                includeAdminRole={false}
                includeProjectAdminRole={true}
              />
            </Box>
            <Button
              variant="ghost"
              color="red"
              onClick={() => {
                const newProjectRoles = [...projectRoles];
                newProjectRoles.splice(i, 1);
                setProjectRoles(newProjectRoles);
              }}
            >
              Remove
            </Button>
          </Flex>
        </div>
      ))}
      {unusedProjects.length > 0 && (
        <Flex gap="3" align="start">
          <Box flexGrow="1">
            <SelectField
              size="legacy"
              value={newProject}
              onChange={(p) => setNewProject(p)}
              initialOption="Choose Project..."
              options={unusedProjects.map((p) => ({
                label: p.name,
                value: p.id,
              }))}
              disabled={!hasFeature}
            />
          </Box>
          <Button
            variant="outline"
            disabled={!newProject || !hasFeature}
            onClick={() => {
              if (!newProject) return;

              const newProjectRoles: ProjectMemberRole[] = [...projectRoles];
              newProjectRoles.push({
                project: newProject,
                role: defaultRole.role,
                limitAccessByEnvironment: false,
                environments: [],
              });
              setProjectRoles(newProjectRoles);
              setNewProject("");
            }}
          >
            Add Project role
          </Button>
        </Flex>
      )}
    </>
  );
}
