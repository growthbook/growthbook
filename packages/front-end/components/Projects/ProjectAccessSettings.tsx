import { FC, useState } from "react";
import { ProjectInterface } from "shared/types/project";
import { putProjectValidator } from "shared/validators";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useRestApiCall } from "@/services/restApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";

const ProjectAccessSettings: FC<{
  project: ProjectInterface;
}> = ({ project }) => {
  const { users, teams, hasCommercialFeature } = useUser();
  const { mutateDefinitions } = useDefinitions();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();

  const [saving, setSaving] = useState(false);

  const canEdit = permissionsUtil.canUpdateProject(project.id);
  const canRestrictAccess = hasCommercialFeature("advanced-permissions");

  const hasExplicitGrants = Array.from(users.values()).some(
    (member) =>
      member.projectRoles?.some((pr) => pr.project === project.id) ||
      (member.teams || []).some((id) =>
        (teams || [])
          .find((t) => t.id === id)
          ?.projectRoles?.some((pr) => pr.project === project.id),
      ),
  );

  const saveRestrictAccess = async (value: boolean) => {
    setSaving(true);
    try {
      await restApiCall(putProjectValidator, {
        params: { id: project.id },
        body: { restrictAccess: value },
      });
      await mutateDefinitions();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Frame px="4" py="4" mb="4">
      <Heading as="h5" size="sm" mb="3">
        User Access
      </Heading>
      <PremiumTooltip commercialFeature="advanced-permissions">
        <Checkbox
          label="Restrict access"
          description={
            <Text color="text-high">
              Members need a role on this Project, assigned directly or through
              a team, to see it. Admins always keep access.
            </Text>
          }
          value={!!project.restrictAccess}
          setValue={saveRestrictAccess}
          disabled={!canEdit || !canRestrictAccess || saving}
        />
      </PremiumTooltip>
      {project.restrictAccess && !hasExplicitGrants ? (
        <Callout status="warning" mt="3">
          No members have an explicit role on this project yet, so only members
          who can manage the team can access it.
        </Callout>
      ) : null}
    </Frame>
  );
};

export default ProjectAccessSettings;
