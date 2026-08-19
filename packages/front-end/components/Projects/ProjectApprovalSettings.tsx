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
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import {
  inheritedFlagRule,
  inheritedSavedGroupRule,
  ownFlagRule,
  ownSavedGroupRule,
  ruleForScope,
  withRuleForScope,
  withoutScope,
} from "@/components/GeneralSettings/approvalScopes";
import { ApprovalScopeSections } from "@/components/GeneralSettings/ApprovalScopeFields";

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

  const inheritedFlags = inheritedFlagRule(storedFlagRules, project);
  const inheritedSavedGroups = inheritedSavedGroupRule(
    storedSavedGroupRules,
    project,
  );
  const [flagRule, setFlagRule] = useState<RequireReview>(() =>
    ownFlagRule(storedFlagRules, project, inheritedFlags),
  );
  const [savedGroupRule, setSavedGroupRule] =
    useState<ApprovalFlowConfiguration>(() =>
      ownSavedGroupRule(storedSavedGroupRules, project, inheritedSavedGroups),
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

      <Frame p="4" mb="0">
        <ApprovalScopeSections
          idPrefix="project"
          flagRule={flagRule}
          inheritedFlagRule={inheritedFlags}
          onFlagChange={setFlagRule}
          savedGroupRule={savedGroupRule}
          inheritedSavedGroupRule={inheritedSavedGroups}
          onSavedGroupChange={setSavedGroupRule}
          savedGroupDescription="Applies to Saved Groups belonging to this project. A group in several projects must satisfy each of their requirements."
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
              setFlagRule(ownFlagRule([], project, inheritedFlags));
              setSavedGroupRule(
                ownSavedGroupRule([], project, inheritedSavedGroups),
              );
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
