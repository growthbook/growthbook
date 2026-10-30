import { FC, useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ProjectInterface } from "shared/types/project";
import { ExpandedMember } from "shared/types/organization";
import { putProjectValidator } from "shared/validators";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useRestApiCall } from "@/services/restApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Metadata from "@/ui/Metadata";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

const ProjectAccessSettings: FC<{
  project: ProjectInterface;
}> = ({ project }) => {
  const { userId, users, teams, hasCommercialFeature } = useUser();
  const { mutateDefinitions } = useDefinitions();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restrictAccess, setRestrictAccess] = useState(false);
  const [allowTargeting, setAllowTargeting] = useState(true);

  const canEdit = permissionsUtil.canUpdateProject(project.id);
  const unchanged =
    restrictAccess === !!project.restrictAccess &&
    allowTargeting === (project.allowTargeting !== false);

  // The modal used to manage focus; keep keyboard users in place.
  const editButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) {
      editor.current
        ?.querySelector<HTMLElement>('[role="checkbox"]:not([disabled])')
        ?.focus();
    } else if (wasEditing.current) {
      editButton.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);
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

  const save = async () => {
    setSaving(true);
    try {
      await restApiCall(putProjectValidator, {
        params: { id: project.id },
        body: { restrictAccess, allowTargeting },
      });
      await mutateDefinitions();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Frame px="4" py="3" mb="4">
      <Flex align="center" justify="between" gap="3" mb="1">
        <Heading as="h5" size="sm" mb="0">
          Project Access
        </Heading>
        {editing ? (
          <Flex gap="3" align="center">
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={save}
              setError={setError}
              loading={saving}
              disabled={unchanged}
            >
              Save
            </Button>
          </Flex>
        ) : (
          <Button
            ref={editButton}
            variant="ghost"
            disabled={!canEdit}
            onClick={() => {
              setRestrictAccess(!!project.restrictAccess);
              setAllowTargeting(project.allowTargeting !== false);
              setError(null);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </Flex>
      {editing ? (
        <Box ref={editor}>
          <PremiumTooltip commercialFeature="advanced-permissions">
            <Checkbox
              label="Restrict user access"
              description="Members need a role on this Project, assigned directly or through a team, to see it. Admins always keep access."
              value={restrictAccess}
              setValue={setRestrictAccess}
              disabled={!canRestrictAccess}
            />
          </PremiumTooltip>
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
          <Checkbox
            mt="4"
            label="Allow targeting from other Projects"
            description="Feature Flags owned by other Projects may add this Project to their Targeting Projects and be delivered to its SDK Connections. Turning this off blocks new targeting; existing targeting is kept."
            value={allowTargeting}
            setValue={setAllowTargeting}
          />
          {error && (
            <Callout status="error" mt="3">
              {error}
            </Callout>
          )}
        </Box>
      ) : (
        <Flex direction="column" gap="1">
          <Metadata
            label="Restrict user access"
            value={project.restrictAccess ? "On" : "Off"}
          />
          <Metadata
            label="Allow targeting from other Projects"
            value={project.allowTargeting !== false ? "On" : "Off"}
          />
        </Flex>
      )}
    </Frame>
  );
};

export default ProjectAccessSettings;
