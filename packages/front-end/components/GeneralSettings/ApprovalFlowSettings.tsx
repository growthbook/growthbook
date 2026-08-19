import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus, PiTrash } from "react-icons/pi";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Frame from "@/ui/Frame";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import {
  ALL_PROJECTS_SCOPE,
  overrideScopes,
  inheritedFlagRule,
  inheritedSavedGroupRule,
  ownFlagRule,
  ownSavedGroupRule,
  scopeProjects,
  withRuleForScope,
  withoutScope,
} from "./approvalScopes";
import { ApprovalScopeSections } from "./ApprovalScopeFields";

export default function ApprovalFlowSettings() {
  const form = useFormContext<OrganizationSettingsWithMetricDefaults>();
  const { hasCommercialFeature } = useUser();
  const { projects } = useDefinitions();

  const hasRequireApprovals = hasCommercialFeature("require-approvals");

  const rawRequireReviews = form.watch("requireReviews");
  const flagRules: RequireReview[] = Array.isArray(rawRequireReviews)
    ? rawRequireReviews
    : [];
  const savedGroupRules: ApprovalFlowConfiguration[] =
    form.watch("approvalFlows.savedGroups") ?? [];

  // A tab the user just opened has no stored rule until they turn something on.
  const [pendingScopes, setPendingScopes] = useState<string[]>([]);
  // Controlled: the shared Tabs wrapper ties uncontrolled tabs to the URL hash,
  // which the settings page's own tab strip already owns.
  const [activeScope, setActiveScope] = useState(ALL_PROJECTS_SCOPE);

  const scopes = [
    ALL_PROJECTS_SCOPE,
    ...new Set([
      ...overrideScopes([flagRules, savedGroupRules]),
      ...pendingScopes.filter((p) => !!p),
    ]),
  ];

  // Radix treats "" as no value, so the all-projects scope needs a real tab id.
  const ALL_PROJECTS_TAB = "all-projects";
  const tabValue = (scope: string) => scope || ALL_PROJECTS_TAB;

  const scopeName = (scope: string) =>
    scope
      ? scopeProjects(scope)
          .map((id) => projects.find((p) => p.id === id)?.name ?? id)
          .join(" + ")
      : "All Projects";

  const setFlagRule = (scope: string, next: RequireReview) =>
    form.setValue("requireReviews", withRuleForScope(flagRules, scope, next));

  const setSavedGroupRule = (scope: string, next: ApprovalFlowConfiguration) =>
    form.setValue(
      "approvalFlows.savedGroups",
      withRuleForScope(savedGroupRules, scope, next),
    );

  const addOverride = (project: string) => {
    setPendingScopes((prev) => [...prev, project]);
    setActiveScope(project);
  };

  const removeOverride = (scope: string) => {
    form.setValue("requireReviews", withoutScope(flagRules, scope));
    form.setValue(
      "approvalFlows.savedGroups",
      withoutScope(savedGroupRules, scope),
    );
    setPendingScopes((prev) => prev.filter((p) => p !== scope));
    setActiveScope(ALL_PROJECTS_SCOPE);
  };

  const availableProjects = projects.filter(
    (p) => !scopes.some((scope) => scopeProjects(scope).includes(p.id)),
  );

  return (
    <Frame>
      <Flex gap="4">
        <Box width="220px" flexShrink="0">
          <Heading size="md" as="h4">
            Approval Flows
          </Heading>
        </Box>
      </Flex>

      <Flex align="start" direction="column" gap="4" mt="7">
        {hasRequireApprovals && (
          <Box width="100%">
            <Text as="p" size="md" mb="3" color="text-low">
              Approval requirements apply per Project. Everything inside the
              panel below belongs to the selected Project scope.
            </Text>
            <Tabs
              value={tabValue(activeScope)}
              onValueChange={(v) =>
                setActiveScope(v === ALL_PROJECTS_TAB ? ALL_PROJECTS_SCOPE : v)
              }
            >
              <Flex align="center" justify="between" gap="3" wrap="wrap">
                <TabsList>
                  {scopes.map((scope) => (
                    <TabsTrigger key={tabValue(scope)} value={tabValue(scope)}>
                      {scopeName(scope)}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {availableProjects.length > 0 && (
                  <DropdownMenu
                    menuPlacement="end"
                    trigger={
                      <Button variant="ghost" size="sm">
                        <PiPlus /> Project override
                      </Button>
                    }
                  >
                    <DropdownMenuGroup>
                      {availableProjects.map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          onClick={() => addOverride(p.id)}
                        >
                          {p.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenu>
                )}
              </Flex>

              {scopes.map((scope) => (
                <TabsContent key={tabValue(scope)} value={tabValue(scope)}>
                  <Frame p="4" mt="3" mb="0">
                    <Flex align="start" justify="between" gap="3" mb="4">
                      <Text size="sm" color="text-low">
                        {scope
                          ? `Applies to ${scopeName(scope)}. Greyed settings are inherited from All Projects — change one to override it here.`
                          : "Applies to every Project without an override of its own."}
                      </Text>
                      {scope ? (
                        <Button
                          variant="ghost"
                          color="red"
                          size="sm"
                          onClick={() => removeOverride(scope)}
                        >
                          <PiTrash /> Remove override
                        </Button>
                      ) : null}
                    </Flex>

                    <ApprovalScopeSections
                      idPrefix={tabValue(scope)}
                      flagRule={ownFlagRule(
                        flagRules,
                        scope,
                        inheritedFlagRule(flagRules, scope),
                      )}
                      inheritedFlagRule={inheritedFlagRule(flagRules, scope)}
                      onFlagChange={(next) => setFlagRule(scope, next)}
                      savedGroupRule={ownSavedGroupRule(
                        savedGroupRules,
                        scope,
                        inheritedSavedGroupRule(savedGroupRules, scope),
                      )}
                      inheritedSavedGroupRule={inheritedSavedGroupRule(
                        savedGroupRules,
                        scope,
                      )}
                      onSavedGroupChange={(next) =>
                        setSavedGroupRule(scope, next)
                      }
                    />
                  </Frame>
                </TabsContent>
              ))}
            </Tabs>
          </Box>
        )}

        {hasRequireApprovals && (
          <Box width="100%">
            <Frame p="3" mb="0">
              <Heading as="h4" size="sm" weight="semibold" mb="4">
                Global
              </Heading>

              <Text as="p" size="md" mb="4" color="text-low">
                These settings apply to every approval flow (Feature Flags,
                Configs, Constants and Saved Groups).
              </Text>

              <Flex direction="column" gap="3" align="start">
                <Checkbox
                  id="toggle-targeting-review-mode"
                  label="Apply approval requirements from Targeting Projects"
                  description="When a Feature Flag is delivered into Targeting Projects, its changes must also satisfy those Projects' approval requirements before publishing. When off, only the primary Project governs approvals."
                  value={targetingStrict(form)}
                  setValue={(v) => setTargetingMode(form, v)}
                />
                <Checkbox
                  id="toggle-restApiBypassesReviews"
                  label="REST API always bypasses approval requirements"
                  description="Applies to Feature Flags, Configs, Constants and Saved Groups. When enabled, all API calls bypass approval requirements. When disabled, API calls are blocked unless the caller's role grants FlagsBypassApprovals — or SavedGroupsBypassApprovals — on that resource's Project."
                  value={form.watch("restApiBypassesReviews") !== false}
                  setValue={(v) => form.setValue("restApiBypassesReviews", v)}
                />
                <Checkbox
                  id="toggle-requireRebaseBeforePublish"
                  label="Require drafts to be rebased with live before publishing"
                  description="Drafts based on an older version — or with a stale approval — must be rebased with live before they can be published."
                  value={form.watch("requireRebaseBeforePublish") === true}
                  setValue={(v) =>
                    form.setValue("requireRebaseBeforePublish", v)
                  }
                />
                <Checkbox
                  id="toggle-reverts-bypass-approval"
                  label="Allow reverts without approval"
                  description="Anyone with the revert permission can revert to a past revision and publish it immediately, even when approvals are required."
                  value={!!form.watch("revertsBypassApproval")}
                  setValue={(v) => form.setValue("revertsBypassApproval", v)}
                />
              </Flex>
            </Frame>
          </Box>
        )}
      </Flex>
    </Frame>
  );
}

type SettingsForm = ReturnType<
  typeof useFormContext<OrganizationSettingsWithMetricDefaults>
>;

// The UI edits the all-projects rule; per-project overrides (API-only for now)
// are preserved.
function targetingStrict(form: SettingsForm): boolean {
  const rules = form.watch("targetingReviewMode") || [];
  const orgWide = rules.find((r) => (r.projects?.length ?? 0) === 0);
  return orgWide ? orgWide.mode === "strict" : true;
}

function setTargetingMode(form: SettingsForm, strict: boolean) {
  const rules = form.watch("targetingReviewMode") || [];
  form.setValue("targetingReviewMode", [
    ...rules.filter((r) => (r.projects?.length ?? 0) > 0),
    { projects: [], mode: strict ? "strict" : "loose" },
  ]);
}
