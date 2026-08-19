import { useEffect, useRef, useState } from "react";
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
import MultiSelectField from "@/ui/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import {
  ALL_PROJECTS_SCOPE,
  overrideScopes,
  clonedFlagRule,
  clonedSavedGroupRule,
  differsFromBase,
  ruleForScope,
  scopeKey,
  inheritedFlagRule,
  inheritedSavedGroupRule,
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

  // Radix treats "" as no value, so the base tab needs a real id of its own.
  const ALL_PROJECTS_TAB = "all-projects";

  const rawRequireReviews = form.watch("requireReviews");
  const flagRules: RequireReview[] = Array.isArray(rawRequireReviews)
    ? rawRequireReviews
    : [];
  const savedGroupRules: ApprovalFlowConfiguration[] =
    form.watch("approvalFlows.savedGroups") ?? [];

  // Tabs carry an identity of their own rather than being keyed by the projects
  // they name, so editing a tab's projects re-points its rule without
  // remounting the panel.
  const [tabs, setTabs] = useState<{ id: string; scope: string }[]>([]);
  const nextTabId = useRef(0);
  const newTabId = () => `override-${nextTabId.current++}`;
  const [activeTab, setActiveTab] = useState(ALL_PROJECTS_TAB);

  // Settings load after mount, so stored overrides get a tab when they arrive.
  const storedScopes = overrideScopes([flagRules, savedGroupRules]);
  useEffect(() => {
    setTabs((prev) => {
      const known = new Set(prev.map((t) => t.scope));
      const missing = storedScopes.filter((scope) => !known.has(scope));
      return missing.length
        ? [...prev, ...missing.map((scope) => ({ id: newTabId(), scope }))]
        : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedScopes.join("|")]);

  const allTabs = [
    { id: ALL_PROJECTS_TAB, scope: ALL_PROJECTS_SCOPE },
    ...tabs,
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

  const addOverride = (project: string) => {
    const id = newTabId();
    setTabs((prev) => [...prev, { id, scope: project }]);
    setActiveTab(id);
    setFlagRule(project, clonedFlagRule(flagRules, project));
    setSavedGroupRule(project, clonedSavedGroupRule(savedGroupRules, project));
  };

  // Re-points both families' rules at a new set of projects, so a group of
  // projects can share one rule instead of duplicating it.
  const retargetTab = (tab: { id: string; scope: string }, next: string[]) => {
    const nextScope = scopeKey(next);
    if (!next.length || nextScope === tab.scope) return;
    const flagOwn = ruleForScope(flagRules, tab.scope);
    if (flagOwn) {
      form.setValue(
        "requireReviews",
        withRuleForScope(flagRules, tab.scope, { ...flagOwn, projects: next }),
      );
    }
    const savedGroupOwn = ruleForScope(savedGroupRules, tab.scope);
    if (savedGroupOwn) {
      form.setValue(
        "approvalFlows.savedGroups",
        withRuleForScope(savedGroupRules, tab.scope, {
          ...savedGroupOwn,
          projects: next,
        }),
      );
    }
    setTabs((prev) =>
      prev.map((t) => (t.id === tab.id ? { ...t, scope: nextScope } : t)),
    );
  };

  const removeOverride = (tab: { id: string; scope: string }) => {
    form.setValue("requireReviews", withoutScope(flagRules, tab.scope));
    form.setValue(
      "approvalFlows.savedGroups",
      withoutScope(savedGroupRules, tab.scope),
    );
    setTabs((prev) => prev.filter((t) => t.id !== tab.id));
    setActiveTab(ALL_PROJECTS_TAB);
  };

  const availableProjects = projects.filter(
    (p) => !allTabs.some((t) => scopeProjects(t.scope).includes(p.id)),
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
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <Flex align="center" justify="between" gap="3" wrap="wrap">
                <TabsList>
                  {allTabs.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id}>
                      <Tooltip
                        body={scopeName(tab.scope)}
                        shouldDisplay={!!tab.scope}
                      >
                        <span
                          style={{
                            display: "block",
                            maxWidth: "160px",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {scopeName(tab.scope)}
                        </span>
                      </Tooltip>
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

              {allTabs.map((tab) => {
                const scope = tab.scope;
                return (
                  <TabsContent key={tab.id} value={tab.id}>
                    <Frame p="4" mt="3" mb="0">
                      <Flex align="start" justify="between" gap="3" mb="4">
                        <Text size="sm" color="text-low">
                          {scope
                            ? "These Projects use this rule instead of All Projects, and do not pick up later changes to it. Reset a section to re-sync it, or Remove override to follow All Projects again."
                            : "Applies to every Project without an override of its own."}
                        </Text>
                        {scope ? (
                          <Button
                            variant="ghost"
                            color="red"
                            size="sm"
                            onClick={() => removeOverride(tab)}
                          >
                            <PiTrash /> Remove override
                          </Button>
                        ) : null}
                      </Flex>

                      {scope ? (
                        <Box mb="4">
                          <MultiSelectField
                            legacyHeight
                            id={`approval-scope-projects-${tab.id}`}
                            label="Projects"
                            labelClassName="font-weight-semibold"
                            containerClassName="mb-0"
                            value={scopeProjects(scope)}
                            onChange={(next) => retargetTab(tab, next)}
                            options={projects
                              .filter(
                                (p) =>
                                  scopeProjects(scope).includes(p.id) ||
                                  !allTabs.some((other) =>
                                    scopeProjects(other.scope).includes(p.id),
                                  ),
                              )
                              .map((p) => ({ value: p.id, label: p.name }))}
                          />
                        </Box>
                      ) : null}

                      <ApprovalScopeSections
                        idPrefix={tab.id}
                        flagRule={clonedFlagRule(flagRules, scope)}
                        onFlagChange={(next) => setFlagRule(scope, next)}
                        onFlagReset={
                          differsFromBase(
                            clonedFlagRule(flagRules, scope),
                            inheritedFlagRule(flagRules, scope),
                          )
                            ? () =>
                                setFlagRule(
                                  scope,
                                  clonedFlagRule(
                                    withoutScope(flagRules, scope),
                                    scope,
                                  ),
                                )
                            : undefined
                        }
                        savedGroupRule={clonedSavedGroupRule(
                          savedGroupRules,
                          scope,
                        )}
                        onSavedGroupChange={(next) =>
                          setSavedGroupRule(scope, next)
                        }
                        onSavedGroupReset={
                          differsFromBase(
                            clonedSavedGroupRule(savedGroupRules, scope),
                            inheritedSavedGroupRule(savedGroupRules, scope),
                          )
                            ? () =>
                                setSavedGroupRule(
                                  scope,
                                  clonedSavedGroupRule(
                                    withoutScope(savedGroupRules, scope),
                                    scope,
                                  ),
                                )
                            : undefined
                        }
                      />
                    </Frame>
                  </TabsContent>
                );
              })}
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
