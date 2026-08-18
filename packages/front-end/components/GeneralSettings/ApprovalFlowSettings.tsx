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
import SelectField from "@/components/Forms/SelectField";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  ALL_PROJECTS_SCOPE,
  flagRuleDefaults,
  overrideScopes,
  ruleForScope,
  savedGroupRuleDefaults,
  scopeProjects,
  withRuleForScope,
  withoutScope,
} from "./approvalScopes";
import {
  FlagApprovalFields,
  SavedGroupApprovalFields,
} from "./ApprovalScopeFields";

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
  const [addingOverride, setAddingOverride] = useState(false);

  const scopes = [
    ALL_PROJECTS_SCOPE,
    ...new Set([
      ...overrideScopes([flagRules, savedGroupRules]),
      ...pendingScopes.filter((p) => !!p),
    ]),
  ];

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

  const removeOverride = (scope: string) => {
    form.setValue("requireReviews", withoutScope(flagRules, scope));
    form.setValue(
      "approvalFlows.savedGroups",
      withoutScope(savedGroupRules, scope),
    );
    setPendingScopes((prev) => prev.filter((p) => p !== scope));
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
            <Tabs defaultValue={ALL_PROJECTS_SCOPE}>
              <Flex align="center" justify="between" gap="3" wrap="wrap">
                <TabsList>
                  {scopes.map((scope) => (
                    <TabsTrigger key={scope || "all"} value={scope}>
                      {scopeName(scope)}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {addingOverride ? (
                  <Box width="260px">
                    <SelectField
                      value=""
                      placeholder="Select a project..."
                      options={availableProjects.map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                      onChange={(id) => {
                        setPendingScopes((prev) => [...prev, id]);
                        setAddingOverride(false);
                      }}
                      containerClassName="mb-0"
                    />
                  </Box>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!availableProjects.length}
                    onClick={() => setAddingOverride(true)}
                  >
                    <PiPlus /> Project override
                  </Button>
                )}
              </Flex>

              {scopes.map((scope) => (
                <TabsContent key={scope || "all"} value={scope}>
                  <Flex direction="column" gap="4" pt="4">
                    {scope ? (
                      <Text size="sm" color="text-low">
                        Overrides the All Projects settings for{" "}
                        {scopeName(scope)}. Anything left off here follows the
                        All Projects tab.
                      </Text>
                    ) : null}

                    <Frame p="3" mb="0">
                      <Heading as="h4" size="sm" weight="semibold" mb="4">
                        Features, Configs, &amp; Constants
                      </Heading>
                      <Text as="p" size="md" mb="4" color="text-low">
                        All changes to Feature Flags, Configs and Constants are
                        tracked as revisions. Requiring approvals adds a review
                        step before any change goes live. Kill switch changes
                        always prompt a confirmation regardless of approval
                        settings.
                      </Text>
                      <FlagApprovalFields
                        idPrefix={`flags-${scope || "all"}`}
                        value={
                          ruleForScope(flagRules, scope) ??
                          flagRuleDefaults(scope)
                        }
                        onChange={(next) => setFlagRule(scope, next)}
                      />
                    </Frame>

                    <Frame p="3" mb="0">
                      <Heading as="h4" size="sm" weight="semibold" mb="4">
                        Saved Groups
                      </Heading>
                      <Text as="p" size="md" mb="4" color="text-low">
                        All changes to Saved Groups are tracked as revisions.
                        Requiring approvals adds a review step before any change
                        goes live.
                      </Text>
                      <SavedGroupApprovalFields
                        idPrefix={`saved-groups-${scope || "all"}`}
                        value={
                          ruleForScope(savedGroupRules, scope) ??
                          savedGroupRuleDefaults(scope)
                        }
                        onChange={(next) => setSavedGroupRule(scope, next)}
                      />
                    </Frame>

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
