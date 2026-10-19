import React, { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import isEqual from "lodash/isEqual";
import isUndefined from "lodash/isUndefined";
import omitBy from "lodash/omitBy";
import {
  ExperimentationHealthSummary,
  computeHealthGrade,
  countHealthOverrides,
  getHealthTargetError,
  resolveGradeWeights,
  resolveHealthTargets,
  resolveQualityScope,
} from "shared/enterprise";
import {
  ExperimentQualityConfigInterface,
  ExperimentationHealthMetricKey,
  ExperimentationHealthSettingsInterface,
  ExperimentationHealthTarget,
  ORG_DEFAULT_SCOPE,
  experimentationHealthMetricKeys,
} from "shared/validators";
import { AIPromptInterface, AI_PROMPT_DEFAULTS } from "shared/ai";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
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
import TargetsTab from "./TargetsTab";
import GradeTab from "./GradeTab";
import ConfigNameModal from "./ConfigNameModal";
import { OverrideDot } from "./OverrideMarker";

// Select items can't use "" as a value
const ORG_SCOPE_OPTION = "__organization__";

// What one scope's record customizes
type ScopeDraft = Pick<
  ExperimentationHealthSettingsInterface,
  "quality" | "targets" | "gradeWeights"
>;

// "a", "a and b", "a, b and c"
function joinList(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function toScopeDraft(
  record: ExperimentationHealthSettingsInterface | null,
): ScopeDraft {
  return {
    quality: record?.quality ?? {},
    targets: record?.targets ?? {},
    gradeWeights: record?.gradeWeights,
  };
}

export default function ExperimentationHealthPage() {
  const { apiCall } = useAuth();
  const { aiEnabled } = useAISettings();
  const permissionsUtil = usePermissionsUtil();
  const {
    projects,
    experimentationHealthSettings,
    getHealthSettingsForScope,
    getExperimentQualityConfigById,
    mutateDefinitions,
  } = useDefinitions();
  const canManageConfigs = permissionsUtil.canManageOrgSettings();

  const [scope, setScope] = useState(ORG_DEFAULT_SCOPE);
  const [resetOpen, setResetOpen] = useState(false);
  const [nameOnSaveOpen, setNameOnSaveOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState(false);
  const [saveError, setSaveError] = useState("");

  const { data: statusData } = useApi<{ stoppedExperiments: number }>(
    "/experiment-quality-score/status",
  );
  const { data: summary, mutate: mutateSummary } =
    useApi<ExperimentationHealthSummary>(
      `/experimentation-health/summary?project=${encodeURIComponent(scope)}`,
    );
  // The org's definition of a good hypothesis seeds the Hypothesis quality
  // check's context
  const { data: promptsData } = useApi<{ prompts: AIPromptInterface[] }>(
    "/ai/prompts",
  );
  const hypothesisDefinition =
    promptsData?.prompts?.find((p) => p.type === "experiment-hypothesis")
      ?.prompt || AI_PROMPT_DEFAULTS["experiment-hypothesis"];

  // --- Scope draft: quality choice, targets and grade weights ---
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
  const targets = resolveHealthTargets(orgForResolve, projectForResolve);
  const weights = resolveGradeWeights(orgForResolve, projectForResolve);

  // --- Config draft: the checks and weights of the configuration in use ---
  // A missing or deleted configuration falls back to the built-in default
  const effectiveConfig: ExperimentQualityConfigInterface | null =
    (effective.configId &&
      getExperimentQualityConfigById(effective.configId)) ||
    null;
  const configSeed = useMemo(
    () => configToDraft(effectiveConfig),
    [effectiveConfig],
  );
  const configKey = `${scope}:${effectiveConfig?.id ?? ""}`;
  const [configEdits, setConfigEdits] = useState<{
    key: string;
    draft: QualityConfigDraft;
  } | null>(null);
  const configDraft =
    configEdits?.key === configKey ? configEdits.draft : configSeed;
  const configDirty = !isEqual(configDraft, configSeed);

  const anyDirty = scopeDirty || configDirty;
  const degenerate = isDegenerateDraft(configDraft);
  const invalidCustomChecks = configDraft.customAiChecks.some(
    (c) => !c.rule.trim(),
  );
  const hasTargetErrors = experimentationHealthMetricKeys.some(
    (k) => !!getHealthTargetError(k, targets[k].target),
  );

  const savedGrade =
    summary &&
    computeHealthGrade({
      ...summary,
      orgRecord,
      projectRecord: isOrgScope ? null : scopeRecord,
    });
  const draftGrade =
    summary &&
    computeHealthGrade({
      ...summary,
      orgRecord: orgForResolve,
      projectRecord: projectForResolve,
    });

  const customizedProjectIds = new Set(
    experimentationHealthSettings
      .filter((r) => r.project !== ORG_DEFAULT_SCOPE && countHealthOverrides(r))
      .map((r) => r.project),
  );
  // What the Project customizes, by tab
  const customized = {
    targets: isOrgScope ? 0 : Object.keys(scopeDraft.targets ?? {}).length,
    grade: !isOrgScope && !!scopeDraft.gradeWeights,
    quality:
      !isOrgScope &&
      Object.values(scopeDraft.quality ?? {}).some((v) => v !== undefined),
  };
  const customizedParts = [
    ...(customized.targets
      ? [
          `${customized.targets} ${customized.targets === 1 ? "target" : "targets"}`,
        ]
      : []),
    ...(customized.grade ? ["the grade weights"] : []),
    ...(customized.quality ? ["quality scoring"] : []),
  ];
  const tabLabel = (label: string, isCustomized: boolean) => (
    <Flex align="center" gap="2">
      {label}
      {isCustomized && <OverrideDot />}
    </Flex>
  );

  async function saveScope(draft: ScopeDraft) {
    await apiCall("/experimentation-health/settings", {
      method: "PUT",
      body: JSON.stringify({ project: scope, ...draft }),
    });
  }

  async function createConfig(name: string): Promise<string> {
    const res = await apiCall<{ config: ExperimentQualityConfigInterface }>(
      "/experiment-quality-score/configs",
      {
        method: "POST",
        body: JSON.stringify({ name, ...draftToConfig(configDraft) }),
      },
    );
    await mutateDefinitions();
    return res.config.id;
  }

  async function afterSave({ scoringChanged }: { scoringChanged: boolean }) {
    setScopeEdits(null);
    setConfigEdits(null);
    await mutateDefinitions();
    // Targets and weights don't change the values; quality settings do
    if (scoringChanged) await mutateSummary();
    setSaveMsg(true);
  }

  async function save() {
    // The built-in default can't be edited, so edits to it are saved as a
    // new named configuration
    if (configDirty && !effectiveConfig) {
      setNameOnSaveOpen(true);
      return;
    }
    if (configDirty && effectiveConfig) {
      await apiCall(`/experiment-quality-score/configs/${effectiveConfig.id}`, {
        method: "PUT",
        body: JSON.stringify(draftToConfig(configDraft)),
      });
    }
    if (scopeDirty) await saveScope(scopeDraft);
    await afterSave({
      scoringChanged:
        configDirty || !isEqual(scopeDraft.quality, savedScope.quality),
    });
  }

  function cancel() {
    setScopeEdits(null);
    setConfigEdits(null);
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
            await afterSave({ scoringChanged: true });
          }}
        >
          <Text as="p">
            Clear every setting customized for {scopeLabel}? It will follow the
            organization default for all of them.
          </Text>
        </ModalStandard>
      )}

      {nameOnSaveOpen && (
        <ConfigNameModal
          header="Name This Configuration"
          cta="Save"
          note={`The GrowthBook default can't be changed, so your edits are saved as a new configuration used by ${scopeLabel}.`}
          close={() => setNameOnSaveOpen(false)}
          submit={async (name) => {
            const configId = await createConfig(name);
            await saveScope({
              ...scopeDraft,
              quality: { ...scopeDraft.quality, configId },
            });
            await afterSave({ scoringChanged: true });
          }}
        />
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
            value={isOrgScope ? ORG_SCOPE_OPTION : scope}
            setValue={(v) =>
              setScope(v === ORG_SCOPE_OPTION ? ORG_DEFAULT_SCOPE : v)
            }
            disabled={anyDirty}
          >
            <SelectItem value={ORG_SCOPE_OPTION}>
              Organization default
            </SelectItem>
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
            {customizedParts.length > 0 && <OverrideDot />}
            <Text size="sm" color="text-mid">
              {customizedParts.length > 0
                ? `${joinList(customizedParts)} customized · everything else follows the organization default`
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

      <Tabs defaultValue="targets" persistInURL mt="4">
        <TabsList>
          <TabsTrigger value="targets">
            {tabLabel("Targets", customized.targets > 0)}
          </TabsTrigger>
          <TabsTrigger value="grade">
            {tabLabel("Grade", customized.grade)}
          </TabsTrigger>
          <TabsTrigger value="quality">
            {tabLabel("Quality Score", customized.quality)}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="targets">
          <TargetsTab
            isOrgScope={isOrgScope}
            targets={targets}
            setTarget={(
              key: ExperimentationHealthMetricKey,
              target: ExperimentationHealthTarget | undefined,
            ) => {
              const next = { ...scopeDraft.targets };
              if (target) next[key] = target;
              else delete next[key];
              updateScope({ targets: next });
            }}
            values={summary?.values}
            ideasInUse={!!summary?.ideasInUse}
            processPending={summary?.processPending ?? 0}
            loading={!summary}
          />
        </TabsContent>
        <TabsContent value="grade">
          <GradeTab
            isOrgScope={isOrgScope}
            weights={weights.weights}
            orgWeights={weights.orgWeights}
            overridden={weights.overridden}
            setWeights={(gradeWeights) => updateScope({ gradeWeights })}
            savedGrade={savedGrade ?? null}
            draftGrade={draftGrade ?? null}
            loading={!summary}
          />
        </TabsContent>
        <TabsContent value="quality">
          <QualityScoreTab
            scope={scope}
            orgQuality={
              (isOrgScope ? scopeDraft.quality : orgRecord?.quality) ?? {}
            }
            qualityDraft={scopeDraft.quality ?? {}}
            setQualityDraft={(quality) =>
              // Drop reset fields so an undone change doesn't read as an edit
              updateScope({ quality: omitBy(quality, isUndefined) })
            }
            effective={effective}
            effectiveConfig={effectiveConfig}
            configDraft={configDraft}
            setConfigDraft={(draft) =>
              setConfigEdits({ key: configKey, draft })
            }
            configDirty={configDirty}
            anyDirty={anyDirty}
            canManageConfigs={canManageConfigs}
            aiAvailable={aiEnabled}
            hypothesisDefinition={hypothesisDefinition}
            stoppedExperiments={statusData?.stoppedExperiments}
            createConfig={createConfig}
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
          {hasTargetErrors && (
            <HelperText status="error">
              Fix the invalid targets to save
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
            disabled={
              !anyDirty || degenerate || invalidCustomChecks || hasTargetErrors
            }
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
