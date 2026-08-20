import { Flex } from "@radix-ui/themes";
import NextLink from "next/link";
import { RequireReview } from "shared/types/organization";
import { getReviewSetting } from "shared/util";
import { getApprovalFlowRules } from "shared/enterprise";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { ApprovalScopeSections } from "@/components/GeneralSettings/ApprovalScopeFields";
import {
  flagRuleDefaults,
  flagRulesFromSettings,
  savedGroupRuleDefaults,
} from "@/components/GeneralSettings/approvalScopes";

// Read-only on purpose. A rule can govern several Projects at once, so editing it
// from one Project's page would either change the others silently or fork the
// rule behind the reader's back. Rendered with the same fields as the editor so
// the two cannot drift.
export default function ProjectApprovalSettings({
  project,
  projectName,
}: {
  project: string;
  projectName: string;
}) {
  const { settings, hasCommercialFeature } = useUser();
  const { projects } = useDefinitions();

  if (!hasCommercialFeature("require-approvals")) return null;

  const flagRules: RequireReview[] = flagRulesFromSettings(
    settings.requireReviews,
  );
  const savedGroupRules = settings.approvalFlows?.savedGroups ?? [];

  // What actually applies here, folded the same way the publish gate folds it.
  const flagRule =
    getReviewSetting(flagRules, { project }) ?? flagRuleDefaults(project);
  const savedGroupRule =
    getApprovalFlowRules(settings.approvalFlows, "saved-group", [project])[0] ??
    savedGroupRuleDefaults(project);

  const naming = [
    ...flagRules.filter((r) => r.projects?.includes(project)),
    ...savedGroupRules.filter((r) => r.projects?.includes(project)),
  ];
  const sharedWith = [
    ...new Set(
      naming.flatMap((r) => (r.projects ?? []).filter((p) => p !== project)),
    ),
  ].map((id) => projects.find((p) => p.id === id)?.name ?? id);

  return (
    <Flex direction="column" gap="4">
      <Text as="p" size="md" color="text-low">
        {!naming.length ? (
          <>
            {projectName} follows the organization&apos;s All Projects approval
            settings.
          </>
        ) : sharedWith.length ? (
          <>
            {projectName} is governed by a rule it shares with{" "}
            {sharedWith.join(", ")}.
          </>
        ) : (
          <>{projectName} has its own approval settings.</>
        )}{" "}
        <NextLink href="/settings#approval-flow" legacyBehavior>
          <Link>Edit in organization settings</Link>
        </NextLink>
      </Text>

      <Frame p="4" mb="0">
        <ApprovalScopeSections
          readOnly
          idPrefix={`project-${project}`}
          flagRule={flagRule}
          onFlagChange={() => undefined}
          savedGroupRule={savedGroupRule}
          onSavedGroupChange={() => undefined}
          savedGroupDescription="Applies to Saved Groups in this Project. A group in several Projects must satisfy each of their requirements."
        />
      </Frame>
    </Flex>
  );
}
