import { FC, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ProjectInterface } from "shared/types/project";
import { ExpandedMember } from "shared/types/organization";
import { putProjectValidator } from "shared/validators";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useRestApiCall } from "@/services/restApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

const ProjectAccessSettings: FC<{
  project: ProjectInterface;
}> = ({ project }) => {
  const { userId, users, teams, hasCommercialFeature } = useUser();
  const { mutateDefinitions } = useDefinitions();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();

  const [modalOpen, setModalOpen] = useState(false);
  const [restrictAccess, setRestrictAccess] = useState(false);

  const canEdit = permissionsUtil.canUpdateProject(project.id);
  const canRestrictAccess = hasCommercialFeature("advanced-permissions");

  const hasExplicitGrant = (member: ExpandedMember | undefined) =>
    !!member &&
    (member.projectRoles?.some((pr) => pr.project === project.id) ||
      (member.teams || []).some((id) =>
        (teams || [])
          .find((t) => t.id === id)
          ?.projectRoles?.some((pr) => pr.project === project.id),
      ));

  const hasExplicitGrants = Array.from(users.values()).some(hasExplicitGrant);

  // Enabling restriction without a role of your own locks you out too.
  const locksOutSelf =
    !permissionsUtil.canManageTeam() &&
    !hasExplicitGrant(userId ? users.get(userId) : undefined);

  return (
    <>
      {modalOpen && (
        <ModalStandard
          trackingEventModalType=""
          open={true}
          close={() => setModalOpen(false)}
          header="Edit User Access"
          submit={async () => {
            await restApiCall(putProjectValidator, {
              params: { id: project.id },
              body: { restrictAccess },
            });
            await mutateDefinitions();
          }}
        >
          <Checkbox
            label="Restrict access"
            description="Members need a role on this Project, assigned directly or through a team, to see it. Admins always keep access."
            value={restrictAccess}
            setValue={setRestrictAccess}
            disabled={!canRestrictAccess}
          />
          {restrictAccess && locksOutSelf ? (
            <Callout status="error" mt="3">
              You do not have a role on this Project, so you will lose access to
              it when this is saved. Only an admin can undo it.
            </Callout>
          ) : restrictAccess && !hasExplicitGrants ? (
            <Callout status="warning" mt="3">
              No members have an explicit role on this Project yet, so only
              admins will be able to access it.
            </Callout>
          ) : null}
        </ModalStandard>
      )}
      <Frame px="4" py="3" mb="4">
        <Heading as="h5" size="xs" mb="2">
          User Access
        </Heading>
        <Flex align="center" justify="between" gap="3">
          <Flex align="center" gap="2" wrap="wrap">
            <Text size="sm" color="text-low">
              Restrict access
            </Text>
            <Text size="sm" weight="medium">
              {project.restrictAccess ? "On" : "Off"}
            </Text>
          </Flex>
          <PremiumTooltip commercialFeature="advanced-permissions">
            <Button
              variant="ghost"
              disabled={!canEdit || !canRestrictAccess}
              onClick={() => {
                setRestrictAccess(!!project.restrictAccess);
                setModalOpen(true);
              }}
            >
              Edit
            </Button>
          </PremiumTooltip>
        </Flex>
      </Frame>
    </>
  );
};

export default ProjectAccessSettings;
