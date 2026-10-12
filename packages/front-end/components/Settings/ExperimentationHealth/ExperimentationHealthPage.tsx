import React, { useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentQualityConfigInterface,
  resolveQualityScope,
} from "shared/enterprise";
import { ExperimentationHealthQualitySettings } from "shared/validators";
import { AIPromptInterface, AI_PROMPT_DEFAULTS } from "shared/ai";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import TempMessage from "@/components/TempMessage";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  configToDraft,
  draftToConfig,
  isDegenerateDraft,
} from "@/components/Settings/ExperimentQuality/qualityConfigDraft";
import QualityScoreTab, {
  GROWTHBOOK_DEFAULT_CONFIG_LABEL,
} from "./QualityScoreTab";
import { OverrideDot } from "./OverrideMarker";

const ORG_SCOPE = "";

function countOverrides(quality?: ExperimentationHealthQualitySettings) {
  return Object.values(quality ?? {}).filter((v) => v !== undefined).length;
}

export default function ExperimentationHealthPage() {
  const { apiCall } = useAuth();
  const orgSettings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const {
    projects,
    experimentationHealthSettings,
    getHealthSettingsForScope,
    getExperimentQualityConfigById,
    mutateDefinitions,
  } = useDefinitions();

  const canManageConfigs = permissionsUtil.canManageOrgSettings();
  const aiAvailable = !!orgSettings.aiEnabled;

  const [scope, setScope] = useState(ORG_SCOPE);
  const [resetOpen, setResetOpen] = useState(false);
  const [nameOnSaveOpen, setNameOnSaveOpen] = useState(false);
  const [newConfigName, setNewConfigName] = useState("");
  const [saveMsg, setSaveMsg] = useState(false);
  const [saveError, setSaveError] = useState("");

  const { data: statusData } = useApi<{ stoppedExperiments: number }>(
    "/experiment-quality-score/status",
  );
  // The org's definition of a good hypothesis (customized on the AI
  // settings page, else the shared default) seeds the Hypothesis quality
  // check's context
  const { data: promptsData } = useApi<{ prompts: AIPromptInterface[] }>(
    "/ai/prompts",
  );
  const hypothesisDefinition =
    promptsData?.prompts?.find((p) => p.type === "experiment-hypothesis")
      ?.prompt || AI_PROMPT_DEFAULTS["experiment-hypothesis"];

  // --- Scope settings draft (quality on/off + configuration choice) ---
  const orgRecord = getHealthSettingsForScope(ORG_SCOPE);
  const scopeRecord = getHealthSettingsForScope(scope);
  const savedQualityKey = JSON.stringify([scope, scopeRecord?.quality ?? {}]);
  const savedQuality = useMemo<ExperimentationHealthQualitySettings>(
    () => scopeRecord?.quality ?? {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedQualityKey],
  );
  const [qualityDraft, setQualityDraft] = useState(savedQuality);
  useEffect(() => setQualityDraft(savedQuality), [savedQuality]);
  const qualityDirty =
    JSON.stringify(qualityDraft) !== JSON.stringify(savedQuality);

  const isOrgScope = scope === ORG_SCOPE;
  const effective = isOrgScope
    ? resolveQualityScope({ quality: qualityDraft }, null)
    : resolveQualityScope(orgRecord, { quality: qualityDraft });

  // --- Configuration draft (the checks and weights being edited) ---
  // A missing or deleted configuration falls back to the built-in default
  const effectiveConfig: ExperimentQualityConfigInterface | null =
    (effective.configId &&
      getExperimentQualityConfigById(effective.configId)) ||
    null;
  const configSeedKey = JSON.stringify(effectiveConfig);
  const configSeed = useMemo(
    () =>
      configToDraft(
        effectiveConfig,
        effectiveConfig?.name ?? GROWTHBOOK_DEFAULT_CONFIG_LABEL,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configSeedKey],
  );
  const [configDraft, setConfigDraft] = useState(configSeed);
  useEffect(() => setConfigDraft(configSeed), [configSeed]);
  const configDirty =
    JSON.stringify(configDraft) !== JSON.stringify(configSeed);

  const anyDirty = qualityDirty || configDirty;
  const degenerate = isDegenerateDraft(configDraft);
  const invalidCustomChecks = configDraft.customAiChecks.some(
    (c) => !c.rule.trim(),
  );

  const customizedProjectIds = new Set(
    experimentationHealthSettings
      .filter((r) => r.project !== ORG_SCOPE && countOverrides(r.quality))
      .map((r) => r.project),
  );
  const draftOverrideCount = countOverrides(qualityDraft);

  async function saveScope(quality: ExperimentationHealthQualitySettings) {
    await apiCall("/experimentation-health/settings", {
      method: "PUT",
      body: JSON.stringify({ project: scope, quality }),
    });
  }

  async function save() {
    // Edits to the built-in default become a new named configuration
    if (configDirty && !effectiveConfig) {
      setNewConfigName("");
      setNameOnSaveOpen(true);
      return;
    }
    if (configDirty && effectiveConfig) {
      await apiCall(`/experiment-quality-score/configs/${effectiveConfig.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: effectiveConfig.name,
          ...draftToConfig(configDraft),
        }),
      });
    }
    if (qualityDirty) await saveScope(qualityDraft);
    await mutateDefinitions();
    setSaveMsg(true);
  }

  function cancel() {
    setQualityDraft(savedQuality);
    setConfigDraft(configSeed);
    setSaveError("");
  }

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
            await mutateDefinitions();
          }}
        >
          <Text as="p">
            Clear every setting customized for {scopeLabel}? It will follow the
            organization default for all of them.
          </Text>
        </ModalStandard>
      )}

      {nameOnSaveOpen && (
        <ModalStandard
          open
          trackingEventModalType="name-experiment-quality-config"
          header="Name This Configuration"
          cta="Save"
          ctaEnabled={!!newConfigName.trim()}
          close={() => setNameOnSaveOpen(false)}
          submit={async () => {
            const res = await apiCall<{
              config: ExperimentQualityConfigInterface;
            }>("/experiment-quality-score/configs", {
              method: "POST",
              body: JSON.stringify({
                name: newConfigName.trim(),
                ...draftToConfig(configDraft),
              }),
            });
            await saveScope({ ...qualityDraft, configId: res.config.id });
            await mutateDefinitions();
            setSaveMsg(true);
          }}
        >
          <Field
            label="Name"
            value={newConfigName}
            onChange={(e) => setNewConfigName(e.target.value)}
            placeholder="e.g. Growth team standards"
            autoFocus
          />
          <Text size="sm" color="text-mid">
            The GrowthBook default can&apos;t be changed, so your edits are
            saved as a new configuration used by {scopeLabel}.
          </Text>
        </ModalStandard>
      )}

      <Heading as="h1" size="xl" mb="1">
        Experimentation Health
      </Heading>
      <Text size="md" color="text-mid">
        Set the targets your program is graded against, and define what a
        quality experiment looks like.
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
            value={scope}
            setValue={setScope}
            disabled={anyDirty}
          >
            <SelectItem value={ORG_SCOPE}>Organization default</SelectItem>
            {projects.length > 0 && <SelectSeparator />}
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <Flex align="center" gap="2">
                  {p.name}
                  {customizedProjectIds.has(p.id) && <OverrideDot />}
                </Flex>
              </SelectItem>
            ))}
          </Select>
        </Flex>
        {anyDirty && (
          <Text size="sm" color="text-low">
            Save or cancel your changes to switch scope
          </Text>
        )}
        {!anyDirty && isOrgScope && customizedProjectIds.size > 0 && (
          <Text size="sm" color="text-low">
            {customizedProjectIds.size}{" "}
            {customizedProjectIds.size === 1 ? "Project" : "Projects"}{" "}
            customized
          </Text>
        )}
        {!anyDirty && !isOrgScope && (
          <Flex align="center" gap="2">
            {draftOverrideCount > 0 && <OverrideDot />}
            <Text size="sm" color="text-mid">
              {draftOverrideCount > 0
                ? `${draftOverrideCount} ${draftOverrideCount === 1 ? "setting" : "settings"} customized · everything else follows the organization default`
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

      <Tabs defaultValue="quality" persistInURL mt="4">
        <TabsList>
          <TabsTrigger value="quality">Quality Score</TabsTrigger>
        </TabsList>
        <TabsContent value="quality">
          <QualityScoreTab
            scope={scope}
            orgQuality={isOrgScope ? qualityDraft : (orgRecord?.quality ?? {})}
            qualityDraft={qualityDraft}
            setQualityDraft={setQualityDraft}
            effective={effective}
            effectiveConfig={effectiveConfig}
            configDraft={configDraft}
            setConfigDraft={setConfigDraft}
            configDirty={configDirty}
            anyDirty={anyDirty}
            canManageConfigs={canManageConfigs}
            aiAvailable={aiAvailable}
            hypothesisDefinition={hypothesisDefinition}
            stoppedExperiments={statusData?.stoppedExperiments}
          />
        </TabsContent>
      </Tabs>

      {/* Single save for the whole page */}
      <Box
        className="bg-main-color position-sticky w-100 py-3 border-top"
        style={{ bottom: 0, zIndex: 840 }}
        mt="4"
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
            <TempMessage
              className="mb-0"
              size="sm"
              close={() => setSaveMsg(false)}
            >
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
