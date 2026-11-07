import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus, PiTrash } from "react-icons/pi";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Frame from "@/ui/Frame";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import PremiumCallout from "@/ui/PremiumCallout";
import { useSettingsNav } from "@/components/Layout/SettingsNavContext";
import Button from "@/ui/Button";
import MultiSelectField from "@/ui/MultiSelectField";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import { SettingsGroup, UnsavedMark } from "./SettingsGroup";
import {
  ALL_PROJECTS_SCOPE,
  overrideScopes,
  clonedFlagRule,
  clonedSavedGroupRule,
  differsFromBase,
  flagRulesFromSettings,
  ruleForScope,
  scopeKey,
  inheritedFlagRule,
  inheritedSavedGroupRule,
  scopeProjects,
  withRuleForScope,
  withoutScope,
} from "./approvalScopes";
import {
  ApprovalScopeSections,
  FlagApprovalFields,
  SavedGroupApprovalFields,
} from "./ApprovalScopeFields";

export default function ApprovalFlowSettings() {
  const form = useFormContext<OrganizationSettingsWithMetricDefaults>();
  const { hasCommercialFeature } = useUser();
  const { projects } = useDefinitions();

  const hasRequireApprovals = hasCommercialFeature("require-approvals");

  // Radix treats "" as no value, so the base tab needs a real id of its own.
  const ALL_PROJECTS_TAB = "all-projects";

  const flagRules: RequireReview[] = flagRulesFromSettings(
    form.watch("requireReviews"),
  );
  const savedGroupRules: ApprovalFlowConfiguration[] =
    form.watch("approvalFlows.savedGroups") ?? [];

  // Tabs carry their own id, so editing their projects does not remount them.
  const [tabs, setTabs] = useState<{ id: string; scope: string }[]>([]);
  const nextTabId = useRef(0);
  const newTabId = () => `override-${nextTabId.current++}`;
  const { setQuery } = useSettingsNav();

  // Deep links (e.g. from a team's Required Approver list) name a Project;
  // open the rule that governs it once its tab exists.
  const router = useRouter();
  const requestedProject = router.query.approvalProject;
  const requestApplied = useRef(false);
  useEffect(() => {
    if (requestApplied.current || typeof requestedProject !== "string") return;
    const tab = tabs.find((t) =>
      scopeProjects(t.scope).includes(requestedProject),
    );
    if (tab) {
      document
        .getElementById(`approval-override-${tab.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      requestApplied.current = true;
    }
  }, [tabs, requestedProject]);

  // Tabs follow the form rules, which load after mount and reset on Discard.
  const storedScopeKey = overrideScopes([flagRules, savedGroupRules]).join("|");
  useEffect(() => {
    const stored = storedScopeKey ? storedScopeKey.split("|") : [];
    setTabs((prev) => {
      const kept = prev.filter((t) => stored.includes(t.scope));
      const known = new Set(kept.map((t) => t.scope));
      const missing = stored.filter((scope) => !known.has(scope));
      return kept.length === prev.length && !missing.length
        ? prev
        : [...kept, ...missing.map((scope) => ({ id: newTabId(), scope }))];
    });
  }, [storedScopeKey]);

  const allTabs = [
    { id: ALL_PROJECTS_TAB, scope: ALL_PROJECTS_SCOPE },
    ...tabs,
  ];

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
    setFlagRule(project, clonedFlagRule(flagRules, project));
    setSavedGroupRule(project, clonedSavedGroupRule(savedGroupRules, project));
  };

  // Re-points both families' rules so a group of projects can share one rule.
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
  };

  const availableProjects = projects.filter(
    (p) => !allTabs.some((t) => scopeProjects(t.scope).includes(p.id)),
  );

  // Overrides are wholesale rules the base tab's settings never reach.
  const overriddenProjects = useMemo(
    () =>
      [...new Set(tabs.flatMap((t) => scopeProjects(t.scope)))].map((id) => ({
        id,
        name: projects.find((p) => p.id === id)?.name ?? id,
      })),
    [tabs, projects],
  );

  if (!hasRequireApprovals) {
    return (
      <SettingsGroup
        id="ap-flows"
        title="Approval Flows"
        description="Every change to flags, Configs, Constants, and Saved Groups is saved as a revision. Approval adds a review step before it goes live."
        keywords="approval review publish"
      >
        <PremiumCallout
          commercialFeature="require-approvals"
          id="settings-approval-flows"
        >
          Approval Flows add a review step before changes to flags, Configs,
          Constants, and Saved Groups go live.
        </PremiumCallout>
      </SettingsGroup>
    );
  }

  const overrideNote = overriddenProjects.length > 0 && (
    <Callout status="info" size="sm">
      Approval settings are overridden in{" "}
      {overriddenProjects.map((p, i) => (
        <span key={p.id}>
          {i > 0 && (i === overriddenProjects.length - 1 ? " and " : ", ")}
          <strong>{p.name}</strong>
        </span>
      ))}
      .{" "}
      <Link href="#ap-overrides" onClick={() => setQuery("")}>
        Manage Project overrides
      </Link>
    </Callout>
  );

  return (
    <>
      {overrideNote && <Box mb="3">{overrideNote}</Box>}
      <SettingsGroup
        id="ap-flags"
        title="Feature Flags, Configs & Constants"
        description="Every change is saved as a revision. Approval adds a review step before it goes live."
        keywords="approval review publish reset self-approve one step kill switch metadata environments teams"
      >
        <FlagApprovalFields
          idPrefix="flags-all-projects"
          value={clonedFlagRule(flagRules, ALL_PROJECTS_SCOPE)}
          onChange={(next) => setFlagRule(ALL_PROJECTS_SCOPE, next)}
        />
      </SettingsGroup>

      <SettingsGroup
        id="ap-groups"
        title="Saved Groups"
        description="Every change is saved as a revision. Approval adds a review step before it goes live."
        keywords="approval review saved groups reset self-approve one step metadata teams"
      >
        <SavedGroupApprovalFields
          idPrefix="saved-groups-all-projects"
          value={clonedSavedGroupRule(savedGroupRules, ALL_PROJECTS_SCOPE)}
          onChange={(next) => setSavedGroupRule(ALL_PROJECTS_SCOPE, next)}
        />
      </SettingsGroup>

      <SettingsGroup
        id="ap-overrides"
        title="Project Overrides"
        description="Projects with their own approval rules instead of the rules above. Each Project belongs to a single override."
        keywords="project override approval"
      >
        {tabs.length === 0 && (
          <Text color="text-mid">
            No Project overrides. Every Project uses the rules above.
          </Text>
        )}
        {tabs.map((tab) => {
          const scope = tab.scope;
          return (
            <Frame
              key={tab.id}
              id={`approval-override-${tab.id}`}
              p="4"
              mb="0"
              style={{ scrollMarginTop: 80 }}
            >
              <Flex align="end" justify="between" gap="3" mb="4" wrap="wrap">
                <Box flexGrow="1" minWidth="240px">
                  <Text as="label" size="md" weight="semibold">
                    Projects
                  </Text>
                  <MultiSelectField
                    legacyHeight
                    id={`approval-scope-projects-${tab.id}`}
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
                <Button
                  variant="ghost"
                  color="red"
                  size="sm"
                  onClick={() => removeOverride(tab)}
                >
                  <PiTrash /> Remove override
                </Button>
              </Flex>

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
                          clonedFlagRule(withoutScope(flagRules, scope), scope),
                        )
                    : undefined
                }
                savedGroupRule={clonedSavedGroupRule(savedGroupRules, scope)}
                onSavedGroupChange={(next) => setSavedGroupRule(scope, next)}
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
          );
        })}
        {availableProjects.length > 0 && (
          <Box>
            <DropdownMenu
              trigger={
                <Button variant="outline" size="sm" icon={<PiPlus />}>
                  Add Project override
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
          </Box>
        )}
      </SettingsGroup>

      <SettingsGroup
        id="ap-global"
        title="Global"
        badge="Organization-wide"
        description="Apply to every approval flow. Projects cannot override these."
        keywords="targeting projects rest api bypass rebase reverts"
      >
        <Flex direction="column" gap="3" align="start">
          <UnsavedMark name="targetingReviewMode">
            <Checkbox
              id="toggle-targeting-review-mode"
              label="Apply approval rules from Targeting Projects"
              description="Flags delivered into Targeting Projects must also meet those Projects' approval rules, with approval from a reviewer in each. When off, only the primary Project's rules apply."
              value={targetingStrict(form)}
              setValue={(v) => setTargetingMode(form, v)}
            />
          </UnsavedMark>
          <UnsavedMark name="restApiBypassesReviews">
            <Checkbox
              id="toggle-restApiBypassesReviews"
              label="REST API bypasses approvals"
              description="Applies to Feature Flags, Configs, Constants, and Saved Groups. When off, API calls are blocked unless the caller's role grants FlagsBypassApprovals or SavedGroupsBypassApprovals in that Project."
              value={form.watch("restApiBypassesReviews") !== false}
              setValue={(v) => form.setValue("restApiBypassesReviews", v)}
            />
          </UnsavedMark>
          <UnsavedMark name="requireRebaseBeforePublish">
            <Checkbox
              id="toggle-requireRebaseBeforePublish"
              label="Require drafts to be rebased before publishing"
              description="Drafts based on an older version, or with a stale approval, must be rebased on the live version first."
              value={form.watch("requireRebaseBeforePublish") === true}
              setValue={(v) => form.setValue("requireRebaseBeforePublish", v)}
            />
          </UnsavedMark>
          <UnsavedMark name="revertsBypassApproval">
            <Checkbox
              id="toggle-reverts-bypass-approval"
              label="Allow reverts without approval"
              description="People with revert permission can restore and publish a past revision immediately, even when approvals are required."
              value={!!form.watch("revertsBypassApproval")}
              setValue={(v) => form.setValue("revertsBypassApproval", v)}
            />
          </UnsavedMark>
        </Flex>
      </SettingsGroup>
    </>
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
