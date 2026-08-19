import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiTrash } from "react-icons/pi";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import {
  displayedFlagRule,
  displayedSavedGroupRule,
  flagRuleDefaults,
  ruleForScope,
  savedGroupRuleDefaults,
  withRuleForScope,
  withoutScope,
} from "@/components/GeneralSettings/approvalScopes";
import {
  FlagApprovalFields,
  SavedGroupApprovalFields,
} from "@/components/GeneralSettings/ApprovalScopeFields";

// The same two sections the org settings tabs render, fixed to this project's
// scope. Editing here writes that project's override.
export default function ProjectApprovalSettings({
  project,
  projectName,
}: {
  project: string;
  projectName: string;
}) {
  const { settings, hasCommercialFeature, refreshOrganization } = useUser();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canManageOrgSettings();

  const storedFlagRules: RequireReview[] = Array.isArray(
    settings.requireReviews,
  )
    ? settings.requireReviews
    : [];
  const storedSavedGroupRules = settings.approvalFlows?.savedGroups ?? [];

  const [flagRule, setFlagRule] = useState<RequireReview>(() =>
    displayedFlagRule(storedFlagRules, project),
  );
  const [savedGroupRule, setSavedGroupRule] =
    useState<ApprovalFlowConfiguration>(() =>
      displayedSavedGroupRule(storedSavedGroupRules, project),
    );
  const [saving, setSaving] = useState(false);

  if (!hasCommercialFeature("require-approvals")) return null;

  const hasOverride =
    !!ruleForScope(storedFlagRules, project) ||
    !!ruleForScope(storedSavedGroupRules, project);

  const save = async (
    requireReviews: RequireReview[],
    savedGroups: ApprovalFlowConfiguration[],
  ) => {
    setSaving(true);
    try {
      await apiCall("/organization", {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            requireReviews,
            approvalFlows: { ...settings.approvalFlows, savedGroups },
          },
        }),
      });
      await refreshOrganization();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flex direction="column" gap="4">
      <Callout status="info">
        These settings override the organization defaults for {projectName}{" "}
        only. <Link href="/settings#approval-flow">Organization defaults</Link>
      </Callout>

      <Frame p="3" mb="0">
        <Heading as="h4" size="sm" weight="semibold" mb="4">
          Features, Configs, &amp; Constants
        </Heading>
        <Text as="p" size="md" mb="4" color="text-low">
          All changes to Feature Flags, Configs and Constants in this project
          are tracked as revisions. Requiring approvals adds a review step
          before any change goes live.
        </Text>
        <FlagApprovalFields
          idPrefix="project-flags"
          value={flagRule}
          onChange={setFlagRule}
        />
      </Frame>

      <Frame p="3" mb="0">
        <Heading as="h4" size="sm" weight="semibold" mb="4">
          Saved Groups
        </Heading>
        <Text as="p" size="md" mb="4" color="text-low">
          Applies to Saved Groups belonging to this project. A group in several
          projects must satisfy each of their requirements.
        </Text>
        <SavedGroupApprovalFields
          idPrefix="project-saved-groups"
          value={savedGroupRule}
          onChange={setSavedGroupRule}
        />
      </Frame>

      <Flex align="center" gap="3">
        <Button
          disabled={!canEdit}
          loading={saving}
          onClick={() =>
            save(
              withRuleForScope(storedFlagRules, project, flagRule),
              withRuleForScope(storedSavedGroupRules, project, savedGroupRule),
            )
          }
        >
          Save
        </Button>
        {hasOverride && (
          <Button
            variant="ghost"
            color="red"
            disabled={!canEdit}
            onClick={async () => {
              await save(
                withoutScope(storedFlagRules, project),
                withoutScope(storedSavedGroupRules, project),
              );
              setFlagRule(flagRuleDefaults(project));
              setSavedGroupRule(savedGroupRuleDefaults(project));
            }}
          >
            <PiTrash /> Remove override
          </Button>
        )}
        {!canEdit && (
          <Box>
            <Text size="sm" color="text-low">
              Requires permission to manage organization settings.
            </Text>
          </Box>
        )}
      </Flex>
    </Flex>
  );
}
