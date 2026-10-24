import React, { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import isEqual from "lodash/isEqual";
import isUndefined from "lodash/isUndefined";
import omitBy from "lodash/omitBy";
import { countHealthOverrides, resolveQualityScope } from "shared/enterprise";
import {
  ExperimentationHealthSettingsInterface,
  ORG_DEFAULT_SCOPE,
} from "shared/validators";
import { AIPromptInterface, AI_PROMPT_DEFAULTS } from "shared/ai";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import TempMessage from "@/components/TempMessage";
import useApi from "@/hooks/useApi";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  QualityConfigDraft,
  configToDraft,
  draftToConfig,
  isDegenerateDraft,
} from "@/components/Settings/ExperimentQuality/qualityConfigDraft";
import QualityScoreTab from "./QualityScoreTab";
import { OverrideDot } from "./OverrideMarker";

// Select items can't use "" as a value
const ORG_SCOPE_OPTION = "__organization__";

// What one scope's record customizes
type ScopeDraft = Pick<ExperimentationHealthSettingsInterface, "quality">;

function toScopeDraft(
  record: ExperimentationHealthSettingsInterface | null,
): ScopeDraft {
  const { enabled, config } = record?.quality ?? {};
  return { quality: omitBy({ enabled, config }, isUndefined) };
}

export default function ExperimentationHealthPage() {
  const { apiCall } = useAuth();
  const { aiEnabled } = useAISettings();
  const permissionsUtil = usePermissionsUtil();
  const {
    projects,
    experimentationHealthSettings,
    getHealthSettingsForScope,
    mutateDefinitions,
  } = useDefinitions();
  // Org admins edit every scope; Project admins edit their own Projects
  const canManageOrg = permissionsUtil.canManageOrgSettings();
  const editableProjects = projects.filter((p) =>
    permissionsUtil.canUpdateProject(p.id),
  );

  const [scope, setScope] = useState(
    canManageOrg
      ? ORG_DEFAULT_SCOPE
      : (editableProjects[0]?.id ?? ORG_DEFAULT_SCOPE),
  );
  const [resetOpen, setResetOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState(false);
  const [saveError, setSaveError] = useState("");

  const { data: statusData } = useApi<{ experiments: number }>(
    "/experiment-quality-score/status",
  );
  // The org's definition of a good hypothesis seeds the Hypothesis quality
  // check's context
  const { data: promptsData } = useApi<{ prompts: AIPromptInterface[] }>(
    "/ai/prompts",
  );
  const hypothesisDefinition =
    promptsData?.prompts?.find((p) => p.type === "experiment-hypothesis")
      ?.prompt || AI_PROMPT_DEFAULTS["experiment-hypothesis"];

  // --- Scope draft: on/off and the saved checks ---
  const isOrgScope = scope === ORG_DEFAULT_SCOPE;
  const orgRecord = getHealthSettingsForScope(ORG_DEFAULT_SCOPE);
  const scopeRecord = getHealthSettingsForScope(scope);
  const savedScope = useMemo(() => toScopeDraft(scopeRecord), [scopeRecord]);
  // Edits are tagged with their scope so switching scopes drops them
  const [scopeEdits, setScopeEdits] = useState<{
    scope: string;
    draft: ScopeDraft;
  } | null>(null);
  const scopeDraft =
    scopeEdits?.scope === scope ? scopeEdits.draft : savedScope;
  const scopeDirty = !isEqual(scopeDraft, savedScope);
  const updateScope = (changes: Partial<ScopeDraft>) =>
    setScopeEdits({ scope, draft: { ...scopeDraft, ...changes } });

  // On the organization default, the draft is the org record; on a Project,
  // it overrides the saved org record field by field
  const orgForResolve = isOrgScope ? scopeDraft : orgRecord;
  const projectForResolve = isOrgScope ? null : scopeDraft;
  const effective = resolveQualityScope(orgForResolve, projectForResolve);

  // --- Checks draft: the editor's form of the checks in effect ---
  const configSeed = useMemo(
    () => configToDraft(effective.config),
    [effective.config],
  );
  const [configEdits, setConfigEdits] = useState<{
    scope: string;
    draft: QualityConfigDraft;
  } | null>(null);
  const configDraft =
    configEdits?.scope === scope ? configEdits.draft : configSeed;
  const configDirty = !isEqual(configDraft, configSeed);

  const anyDirty = scopeDirty || configDirty;
  const degenerate = isDegenerateDraft(configDraft);
  const invalidCustomChecks = configDraft.customAiChecks.some(
    (c) => !c.rule.trim(),
  );

  const customizedProjectIds = new Set(
    experimentationHealthSettings
      .filter((r) => r.project !== ORG_DEFAULT_SCOPE && countHealthOverrides(r))
      .map((r) => r.project),
  );
  const projectCustomized = !isOrgScope && countHealthOverrides(scopeDraft) > 0;

  async function afterSave() {
    setScopeEdits(null);
    setConfigEdits(null);
    await mutateDefinitions();
    setSaveMsg(true);
  }

  async function save() {
    // Edited checks are saved on this scope's record; on a Project that
    // makes them its own
    const quality = {
      ...scopeDraft.quality,
      ...(configDirty ? { config: draftToConfig(configDraft) } : {}),
    };
    await apiCall("/experimentation-health/settings", {
      method: "PUT",
      body: JSON.stringify({ project: scope, quality }),
    });
    await afterSave();
  }

  function cancel() {
    setScopeEdits(null);
    setConfigEdits(null);
    setSaveError("");
  }

  // Drop reset fields so an undone change doesn't read as an edit
  const setQualityDraft = (quality: ScopeDraft["quality"]) =>
    updateScope({ quality: omitBy(quality, isUndefined) });

  const scopeLabel = isOrgScope
    ? "the organization default"
    : (projects.find((p) => p.id === scope)?.name ?? "this Project");

  return (
    <Box>
      {resetOpen && (
        <ModalStandard
          open
          trackingEventModalType="reset-experimentation-health-project"
          header="Reset to Organization Defaults"
          cta="Reset"
          ctaColor="red"
          close={() => setResetOpen(false)}
          submit={async () => {
            await apiCall(
              `/experimentation-health/settings?project=${encodeURIComponent(scope)}`,
              { method: "DELETE" },
            );
            await afterSave();
          }}
        >
          <Text as="p">
            Clear every setting customized for {scopeLabel}? It will follow the
            organization default for all of them.
          </Text>
        </ModalStandard>
      )}

      <Heading as="h1" size="xl" mb="1">
        Experimentation Health
      </Heading>
      <Text size="md" color="text-mid">
        Define what a quality experiment looks like.
      </Text>

      {/* Scope bar */}
      <Flex
        align="center"
        gap="3"
        mt="4"
        px="3"
        py="2"
        wrap="wrap"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--border-color-200)",
          borderRadius: 8,
        }}
      >
        <Flex align="center" gap="1">
          <Text size="sm" color="text-mid">
            Scope:
          </Text>
          <Select
            size="sm"
            value={isOrgScope ? ORG_SCOPE_OPTION : scope}
            setValue={(v) =>
              setScope(v === ORG_SCOPE_OPTION ? ORG_DEFAULT_SCOPE : v)
            }
            disabled={anyDirty}
          >
            {canManageOrg && (
              <SelectItem value={ORG_SCOPE_OPTION}>
                Organization default
              </SelectItem>
            )}
            {canManageOrg && editableProjects.length > 0 && <SelectSeparator />}
            {editableProjects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <Flex align="center" gap="2">
                  {p.name}
                  {customizedProjectIds.has(p.id) && <OverrideDot />}
                </Flex>
              </SelectItem>
            ))}
          </Select>
        </Flex>
        {anyDirty ? (
          <Text size="sm" color="text-low">
            Save or cancel your changes to switch scope
          </Text>
        ) : isOrgScope ? (
          customizedProjectIds.size > 0 && (
            <Text size="sm" color="text-low">
              {customizedProjectIds.size}{" "}
              {customizedProjectIds.size === 1 ? "Project" : "Projects"}{" "}
              customized
            </Text>
          )
        ) : (
          <Flex align="center" gap="2">
            {projectCustomized && <OverrideDot />}
            <Text size="sm" color="text-mid">
              {projectCustomized
                ? "Quality scoring customized for this Project"
                : "Follows the organization default"}
            </Text>
          </Flex>
        )}
        {!isOrgScope && scopeRecord && (
          <Box ml="auto">
            <Link onClick={() => setResetOpen(true)}>
              Reset all to organization defaults
            </Link>
          </Box>
        )}
      </Flex>

      <Box mt="4">
        <QualityScoreTab
          isOrgScope={isOrgScope}
          orgQuality={
            (isOrgScope ? scopeDraft.quality : orgRecord?.quality) ?? {}
          }
          qualityDraft={scopeDraft.quality ?? {}}
          setQualityDraft={setQualityDraft}
          effective={effective}
          configDraft={configDraft}
          setConfigDraft={(draft) => setConfigEdits({ scope, draft })}
          checksCustomized={effective.overridden.config || configDirty}
          resetChecks={() => {
            setConfigEdits(null);
            setQualityDraft({ ...scopeDraft.quality, config: undefined });
          }}
          anyDirty={anyDirty}
          canRecalculate={canManageOrg}
          aiAvailable={aiEnabled}
          hypothesisDefinition={hypothesisDefinition}
          experimentCount={statusData?.experiments}
        />
      </Box>

      {/* Single save for the whole page */}
      <Box
        py="3"
        mt="4"
        style={{
          position: "sticky",
          bottom: 0,
          zIndex: 840,
          background: "var(--background-color)",
          borderTop: "1px solid var(--border-color-200)",
        }}
      >
        <Flex justify="end" align="center" gap="3">
          {saveError && <HelperText status="error">{saveError}</HelperText>}
          {degenerate && (
            <HelperText status="error">
              At least one check must be enabled to save
            </HelperText>
          )}
          {invalidCustomChecks && (
            <HelperText status="error">
              Custom checks need a rule describing what to evaluate
            </HelperText>
          )}
          {saveMsg && (
            <TempMessage size="sm" close={() => setSaveMsg(false)}>
              Settings saved
            </TempMessage>
          )}
          <Button variant="ghost" disabled={!anyDirty} onClick={cancel}>
            Cancel
          </Button>
          <Button
            disabled={!anyDirty || degenerate || invalidCustomChecks}
            setError={(e) => setSaveError(e ?? "")}
            onClick={save}
          >
            Save
          </Button>
        </Flex>
      </Box>
    </Box>
  );
}
