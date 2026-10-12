import React, { useEffect, useState } from "react";
import { Box, Flex, Tooltip } from "@radix-ui/themes";
import clsx from "clsx";
import { PiCaretRightBold, PiTrash } from "react-icons/pi";
import {
  EXPERIMENT_QUALITY_CHECKS,
  EXPERIMENT_QUALITY_SECTIONS,
  ExperimentQualityCheckKey,
  ExperimentQualityConfigBody,
  ExperimentQualityConfigInterface,
  ExperimentQualitySectionKey,
  MAX_CUSTOM_QUALITY_CHECKS,
  ProjectExperimentQualityPointer,
  experimentQualitySectionKeys,
  getChecksForSection,
  resolveQualityEnabled,
} from "shared/enterprise";
import { ProjectInterface } from "shared/types/project";
import { AIPromptInterface, AI_PROMPT_DEFAULTS } from "shared/ai";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { Select, SelectItem, SelectGroup, SelectLabel } from "@/ui/Select";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import TempMessage from "@/components/TempMessage";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ShareBar from "./ShareBar";
import {
  QualityConfigDraft,
  addCustomCheck,
  configToDraft,
  draftToConfig,
  getEnabledSectionKeys,
  isDegenerateDraft,
  reflowCheckWeights,
  reflowCustomCheckWeights,
  reflowSectionWeights,
  removeCustomCheck,
  setCheckEnabled,
  setCustomCheckEnabled,
  setSectionEnabled,
  updateCustomCheck,
} from "./qualityConfigDraft";
import styles from "./ExperimentQuality.module.scss";

export const SECTION_COLORS: Record<
  ExperimentQualitySectionKey,
  { bar: string; text: string }
> = {
  documentation: { bar: "var(--indigo-9)", text: "var(--indigo-11)" },
  results: { bar: "var(--teal-9)", text: "var(--teal-11)" },
  health: { bar: "var(--orange-9)", text: "var(--orange-11)" },
  ai: { bar: "var(--violet-9)", text: "var(--violet-11)" },
};

const SECTION_NOTES: Partial<Record<ExperimentQualitySectionKey, string>> = {
  results: "stopped only",
  health: "when traffic data exists",
};

const CHECK_QUALIFIERS: Partial<Record<ExperimentQualityCheckKey, string>> = {
  screenshots: "· all except Holdouts",
  decision: "· stopped only",
  learnings: "· stopped only",
  "ai-hypothesis-quality":
    "· judged against the hypothesis definition in AI settings",
  "ai-learnings-quality": "· stopped only",
};

const AI_CONTEXT_PLACEHOLDER =
  "Add guidance for the AI judge, e.g. what a good one looks like at your org";

const DEFAULT_CONFIG_VALUE = "__growthbook-default__";
const CREATE_CONFIG_VALUE = "__create__";

type ScopeValue = "org" | string; // "org" or a project id

function CheckRowView({
  checkKey,
  draft,
  sectionShare,
  color,
  disabled,
  contextFallback,
  onToggle,
  onSplitChange,
  onParamChange,
  onContextChange,
}: {
  checkKey: ExperimentQualityCheckKey;
  draft: QualityConfigDraft;
  sectionShare: number;
  color: { bar: string; text: string };
  disabled: boolean;
  // Shown in the context textarea when the check has no stored context of
  // its own (e.g. the hypothesis definition from AI settings)
  contextFallback?: string;
  onToggle: (v: boolean) => void;
  onSplitChange: (v: number) => void;
  onParamChange: (params: Record<string, number>) => void;
  onContextChange: (v: string) => void;
}) {
  const def = EXPERIMENT_QUALITY_CHECKS[checkKey];
  const check = draft.checks[checkKey];
  const isOn = check.enabled && !disabled;
  const overall = Math.round((sectionShare * check.weight) / 100);

  return (
    <Box py="2" style={{ opacity: isOn ? 1 : 0.5 }}>
      <div className={styles.checkRow}>
        <Checkbox
          mb="0"
          value={check.enabled}
          setValue={onToggle}
          id={`quality-check-${checkKey}`}
          disabled={disabled}
        />
        <Flex align="center" gap="2" wrap="wrap">
          <label htmlFor={`quality-check-${checkKey}`} className="mb-0">
            <Text size="md">{def.label}</Text>
          </label>
          {checkKey === "goal-metrics" && (
            <Flex align="center" gap="1">
              <Text size="sm" color="text-mid">
                · fewer than
              </Text>
              <input
                type="number"
                className={styles.paramInput}
                min={2}
                value={check.params?.maxGoalMetrics ?? 3}
                disabled={!isOn}
                aria-label="Maximum goal metrics"
                onChange={(e) =>
                  onParamChange({ maxGoalMetrics: parseInt(e.target.value) })
                }
              />
            </Flex>
          )}
          {checkKey === "min-runtime" && (
            <Flex align="center" gap="1">
              <Text size="sm" color="text-mid">
                · at least
              </Text>
              <input
                type="number"
                className={styles.paramInput}
                min={1}
                value={check.params?.minRuntimeDays ?? 14}
                disabled={!isOn}
                aria-label="Minimum runtime in days"
                onChange={(e) =>
                  onParamChange({ minRuntimeDays: parseInt(e.target.value) })
                }
              />
              <Text size="sm" color="text-mid">
                days
              </Text>
            </Flex>
          )}
          {CHECK_QUALIFIERS[checkKey] && (
            <Text size="sm" color="text-low">
              {CHECK_QUALIFIERS[checkKey]}
            </Text>
          )}
        </Flex>
        {isOn ? (
          <ShareBar
            value={check.weight}
            onChange={onSplitChange}
            color={color.bar}
            variant="check"
            ariaLabel={`${def.label}, ${overall}% of score`}
          />
        ) : (
          <span
            style={{
              height: 12,
              background: "transparent",
              border: "1px solid var(--border-color-100)",
              borderRadius: 9999,
              display: "block",
            }}
          />
        )}
        <Box style={{ textAlign: "right", lineHeight: 1.25 }}>
          <span
            style={{
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
              color: isOn ? "var(--color-text-high)" : "var(--color-text-low)",
            }}
          >
            {isOn ? `${check.weight}%` : "—"}
          </span>
          <br />
          <Text size="sm" color="text-low">
            {isOn ? `≈${overall}% overall` : "excluded"}
          </Text>
        </Box>
      </div>
      {def.type === "ai" && isOn && (
        <Box mt="1" mb="1" ml="6" pl="1">
          <Text size="sm" weight="medium" color="text-mid" as="p" mb="1">
            Context <Text color="text-low">· optional</Text>
          </Text>
          <Field
            textarea
            minRows={1}
            placeholder={AI_CONTEXT_PLACEHOLDER}
            value={check.aiContext ?? contextFallback ?? ""}
            onChange={(e) => onContextChange(e.target.value)}
          />
        </Box>
      )}
    </Box>
  );
}

function CustomCheckRowView({
  custom,
  sectionShare,
  color,
  disabled,
  onToggle,
  onSplitChange,
  onUpdate,
  onRemove,
}: {
  custom: QualityConfigDraft["customAiChecks"][number];
  sectionShare: number;
  color: { bar: string; text: string };
  disabled: boolean;
  onToggle: (v: boolean) => void;
  onSplitChange: (v: number) => void;
  onUpdate: (updates: { name?: string; rule?: string }) => void;
  onRemove: () => void;
}) {
  const isOn = custom.enabled && !disabled;
  const overall = Math.round((sectionShare * custom.weight) / 100);

  return (
    <Box py="2" style={{ opacity: isOn ? 1 : 0.5 }}>
      <div className={styles.checkRow}>
        <Checkbox
          mb="0"
          value={custom.enabled}
          setValue={onToggle}
          id={`quality-custom-check-${custom.id}`}
          disabled={disabled}
        />
        <Flex align="center" gap="2" wrap="wrap">
          <input
            type="text"
            className={styles.paramInput}
            style={{ width: 220, textAlign: "left", padding: "1px 6px" }}
            placeholder="Name this check"
            value={custom.name}
            disabled={!isOn}
            aria-label="Custom check name"
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
          <Badge
            label="Custom"
            color="violet"
            variant="soft"
            radius="full"
            size="xs"
          />
          <Tooltip content="Remove this custom check">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              aria-label="Remove custom check"
            >
              <PiTrash />
            </Button>
          </Tooltip>
        </Flex>
        {isOn ? (
          <ShareBar
            value={custom.weight}
            onChange={onSplitChange}
            color={color.bar}
            variant="check"
            ariaLabel={`${custom.name || "Custom check"}, ${overall}% of score`}
          />
        ) : (
          <span
            style={{
              height: 12,
              background: "transparent",
              border: "1px solid var(--border-color-100)",
              borderRadius: 9999,
              display: "block",
            }}
          />
        )}
        <Box style={{ textAlign: "right", lineHeight: 1.25 }}>
          <span
            style={{
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
              color: isOn ? "var(--color-text-high)" : "var(--color-text-low)",
            }}
          >
            {isOn ? `${custom.weight}%` : "—"}
          </span>
          <br />
          <Text size="sm" color="text-low">
            {isOn ? `≈${overall}% overall` : "excluded"}
          </Text>
        </Box>
      </div>
      {isOn && (
        <Box mt="1" mb="1" ml="6" pl="1">
          <Text size="sm" weight="medium" color="text-mid" as="p" mb="1">
            What to evaluate
          </Text>
          <Field
            textarea
            minRows={1}
            placeholder='Describe how to score this from the experiment data, e.g. "start with 10 points and take off 2 for every goal metric beyond 5"'
            value={custom.rule}
            onChange={(e) => onUpdate({ rule: e.target.value })}
          />
        </Box>
      )}
    </Box>
  );
}

export default function ExperimentQualityScoreSettings() {
  const { hasCommercialFeature, refreshOrganization } = useUser();
  const orgSettings = useOrgSettings();
  const { apiCall } = useAuth();
  const { projects, experimentQualityConfigs, mutateDefinitions } =
    useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const hasFeature = hasCommercialFeature("experiment-quality-score");
  const aiAvailable = !!orgSettings.aiEnabled;
  const canManageConfigs = permissionsUtil.canManageOrgSettings();

  const [scope, setScope] = useState<ScopeValue>("org");
  const [draft, setDraft] = useState<QualityConfigDraft | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [openSections, setOpenSections] = useState<
    Record<ExperimentQualitySectionKey, boolean>
  >({ documentation: false, results: false, health: false, ai: false });
  const [saveMsg, setSaveMsg] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [recalculateStatus, setRecalculateStatus] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: statusData } = useApi<{
    status: number;
    stoppedExperiments: number;
  }>("/experiment-quality-score/status", { shouldRun: () => hasFeature });

  // The org's definition of a good hypothesis (customized on the AI
  // settings page, else the shared default). Seeds the Hypothesis quality
  // check's context textarea; edits there are stored as a per-check
  // override for the quality judge only.
  const { data: promptsData } = useApi<{ prompts: AIPromptInterface[] }>(
    "/ai/prompts",
    { shouldRun: () => hasFeature },
  );
  const hypothesisDefinition =
    promptsData?.prompts?.find((p) => p.type === "experiment-hypothesis")
      ?.prompt || AI_PROMPT_DEFAULTS["experiment-hypothesis"];

  const orgPointer = orgSettings.experimentQuality;
  const scopedProject: ProjectInterface | null =
    scope === "org" ? null : (projects.find((p) => p.id === scope) ?? null);
  const projectPointer = scopedProject?.settings?.experimentQuality;

  // Which config doc the current scope resolves to (undefined = the
  // built-in GrowthBook default; editable — saving edits creates a config)
  const selectedConfigId =
    scope === "org"
      ? orgPointer?.configId
      : (projectPointer?.configId ?? orgPointer?.configId);
  const selectedConfig: ExperimentQualityConfigInterface | undefined =
    selectedConfigId
      ? experimentQualityConfigs.find((c) => c.id === selectedConfigId)
      : undefined;
  const isVirtualDefault = !selectedConfig;

  const canEditPointer =
    scope === "org"
      ? permissionsUtil.canManageOrgSettings()
      : permissionsUtil.canUpdateProject(scope);
  const canEditConfig = canManageConfigs;

  const orgEnabled = orgPointer?.enabled ?? false;
  const effectiveEnabled = resolveQualityEnabled(
    orgPointer,
    scope === "org" ? undefined : projectPointer,
  );

  // (Re-)seed the draft whenever the selected config changes
  const selectedConfigJSON = JSON.stringify(selectedConfig ?? null);
  useEffect(() => {
    // The virtual default seeds "Default" — it becomes the created config's
    // name if edits to the built-in defaults are saved
    const seed = configToDraft(
      selectedConfig,
      selectedConfig?.name ?? "Default",
    );
    setDraft(seed);
    setBaseline(JSON.stringify(seed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConfigJSON]);

  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const degenerate = !!draft && isDegenerateDraft(draft);
  const invalidCustomChecks =
    !!draft && draft.customAiChecks.some((c) => !c.rule.trim());

  const enabledSectionKeys = draft ? getEnabledSectionKeys(draft) : [];
  const stripSections = enabledSectionKeys.filter(
    (k) => k !== "ai" || aiAvailable,
  );
  const stripTotal = stripSections.reduce(
    (sum, k) => sum + (draft?.sections[k].weight ?? 0),
    0,
  );

  async function setOrgPointer(updates: {
    enabled?: boolean;
    configId?: string | null; // null clears the reference
  }) {
    const next = {
      enabled: updates.enabled ?? orgPointer?.enabled ?? false,
      ...(updates.configId === null
        ? {}
        : (updates.configId ?? orgPointer?.configId)
          ? { configId: updates.configId ?? orgPointer?.configId }
          : {}),
    };
    await apiCall("/organization", {
      method: "PUT",
      body: JSON.stringify({ settings: { experimentQuality: next } }),
    });
    refreshOrganization();
    setSaveMsg(true);
  }

  async function setProjectPointer(
    updates: Partial<ProjectExperimentQualityPointer> & {
      clearConfigId?: boolean;
    },
  ) {
    if (!scopedProject) return;
    const next: ProjectExperimentQualityPointer = { ...projectPointer };
    if ("enabled" in updates) {
      if (updates.enabled === undefined) delete next.enabled;
      else next.enabled = updates.enabled;
    }
    if (updates.clearConfigId) delete next.configId;
    else if (updates.configId) next.configId = updates.configId;
    const settings = { ...scopedProject.settings };
    if (Object.keys(next).length === 0) {
      delete settings.experimentQuality;
    } else {
      settings.experimentQuality = next;
    }
    await apiCall(`/projects/${scopedProject.id}/settings`, {
      method: "PUT",
      body: JSON.stringify({ settings }),
    });
    mutateDefinitions();
    setSaveMsg(true);
  }

  async function createConfig(name: string, body: ExperimentQualityConfigBody) {
    const res = await apiCall<{
      status: number;
      config: ExperimentQualityConfigInterface;
    }>("/experiment-quality-score/configs", {
      method: "POST",
      body: JSON.stringify({ name, ...body }),
    });
    await mutateDefinitions();
    // Point the current scope at the new config
    if (scope === "org") {
      await setOrgPointer({ configId: res.config.id });
    } else {
      await setProjectPointer({ configId: res.config.id });
    }
  }

  async function saveConfig() {
    if (!draft) return;
    setSaveError("");
    if (!selectedConfig) {
      // Editing the built-in default: materialize it as the scope's config
      await createConfig(draft.name.trim() || "Default", draftToConfig(draft));
    } else {
      await apiCall(`/experiment-quality-score/configs/${selectedConfig.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: draft.name.trim() || selectedConfig.name,
          ...draftToConfig(draft),
        }),
      });
      await mutateDefinitions();
    }
    setBaseline(JSON.stringify(draft));
    setSaveMsg(true);
  }

  async function deleteConfig() {
    if (!selectedConfig) return;
    setSaveError("");
    // Release this scope's reference first, then delete (the server
    // refuses deletion while any scope still references the config)
    if (scope === "org") {
      await setOrgPointer({ configId: null });
    } else if (projectPointer?.configId) {
      await setProjectPointer({ clearConfigId: true });
    }
    await apiCall(`/experiment-quality-score/configs/${selectedConfig.id}`, {
      method: "DELETE",
    });
    await mutateDefinitions();
    setDeleteConfirmOpen(false);
  }

  if (!draft) return null;

  const configSelectValue = selectedConfig?.id ?? DEFAULT_CONFIG_VALUE;

  const editor = (
    <Box className={clsx(!canEditConfig ? styles.ghosted : undefined)}>
      {/* Distribution strip */}
      <div className={styles.distributionStrip}>
        {stripSections.map((key) => (
          <span
            key={key}
            style={{
              width: `${stripTotal ? (draft.sections[key].weight / stripTotal) * 100 : 0}%`,
              background: SECTION_COLORS[key].bar,
            }}
          />
        ))}
      </div>
      <Flex justify="between" mb="4" mt="1">
        <Text size="sm" color="text-mid">
          How the score divides across sections
        </Text>
        <Text size="sm" color="text-mid">
          Sections always total 100%
        </Text>
      </Flex>

      {/* Section panels */}
      {experimentQualitySectionKeys.map((sectionKey) => {
        const color = SECTION_COLORS[sectionKey];
        const isAI = sectionKey === "ai";
        const sectionOn = enabledSectionKeys.includes(sectionKey);
        const open = openSections[sectionKey];
        const share = sectionOn ? draft.sections[sectionKey].weight : 0;
        const aiParked = isAI && !aiAvailable;

        return (
          <div key={sectionKey} className={styles.sectionPanel}>
            <div
              className={clsx(
                styles.sectionHeader,
                open && !aiParked && styles.withBorder,
              )}
            >
              <Flex align="center" gap="2">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSections((s) => ({
                      ...s,
                      [sectionKey]: !s[sectionKey],
                    }))
                  }
                  aria-expanded={open}
                  aria-label={`Toggle the ${sectionKey} section`}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <PiCaretRightBold
                    size={12}
                    className={clsx(styles.chevron, open && styles.open)}
                  />
                  <span
                    style={{
                      color: color.text,
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {EXPERIMENT_QUALITY_SECTIONS[sectionKey].label}
                  </span>
                </button>
                {SECTION_NOTES[sectionKey] && (
                  <Text size="sm" color="text-low">
                    {SECTION_NOTES[sectionKey]}
                  </Text>
                )}
                {aiParked && (
                  <Text size="sm" color="text-low" ml="2">
                    Not running ·{" "}
                    <Link href="/settings#ai">Go to AI settings</Link>
                  </Text>
                )}
              </Flex>
              <Box>
                {sectionOn && !aiParked && (
                  <ShareBar
                    value={share}
                    onChange={(v) =>
                      setDraft(reflowSectionWeights(draft, sectionKey, v))
                    }
                    color={color.bar}
                    variant="section"
                    ariaLabel={`${sectionKey} section, ${share}% of score`}
                  />
                )}
              </Box>
              <span
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color:
                    sectionOn && !aiParked
                      ? "var(--color-text-high)"
                      : "var(--color-text-low)",
                }}
              >
                {sectionOn && !aiParked ? `${share}%` : "—"}
              </span>
              <Flex align="center" justify="end">
                {!aiParked && (
                  <Tooltip
                    content={`Include the ${EXPERIMENT_QUALITY_SECTIONS[sectionKey].label} section in the score`}
                  >
                    <Switch
                      size="sm"
                      value={
                        isAI
                          ? draft.aiChecksEnabled
                          : draft.sectionEnabled[sectionKey]
                      }
                      onChange={(v) =>
                        setDraft(setSectionEnabled(draft, sectionKey, v))
                      }
                    />
                  </Tooltip>
                )}
              </Flex>
            </div>

            {open && !aiParked && (
              <>
                {getChecksForSection(sectionKey).map((checkKey) => (
                  <CheckRowView
                    key={checkKey}
                    checkKey={checkKey}
                    draft={draft}
                    sectionShare={share}
                    color={color}
                    contextFallback={
                      checkKey === "ai-hypothesis-quality"
                        ? hypothesisDefinition
                        : undefined
                    }
                    disabled={
                      isAI
                        ? !draft.aiChecksEnabled
                        : !draft.sectionEnabled[sectionKey]
                    }
                    onToggle={(v) =>
                      setDraft(setCheckEnabled(draft, checkKey, v))
                    }
                    onSplitChange={(v) =>
                      setDraft(reflowCheckWeights(draft, checkKey, v))
                    }
                    onParamChange={(params) =>
                      setDraft({
                        ...draft,
                        checks: {
                          ...draft.checks,
                          [checkKey]: {
                            ...draft.checks[checkKey],
                            params: {
                              ...draft.checks[checkKey].params,
                              ...params,
                            },
                          },
                        },
                      })
                    }
                    onContextChange={(v) =>
                      setDraft({
                        ...draft,
                        checks: {
                          ...draft.checks,
                          [checkKey]: {
                            ...draft.checks[checkKey],
                            aiContext: v,
                          },
                        },
                      })
                    }
                  />
                ))}
                {isAI &&
                  draft.customAiChecks.map((custom) => (
                    <CustomCheckRowView
                      key={custom.id}
                      custom={custom}
                      sectionShare={share}
                      color={color}
                      disabled={!draft.aiChecksEnabled}
                      onToggle={(v) =>
                        setDraft(setCustomCheckEnabled(draft, custom.id, v))
                      }
                      onSplitChange={(v) =>
                        setDraft(reflowCustomCheckWeights(draft, custom.id, v))
                      }
                      onUpdate={(updates) =>
                        setDraft(updateCustomCheck(draft, custom.id, updates))
                      }
                      onRemove={() =>
                        setDraft(removeCustomCheck(draft, custom.id))
                      }
                    />
                  ))}
                {isAI && (
                  <Box
                    py="2"
                    style={{ borderTop: "1px dashed var(--border-color-100)" }}
                  >
                    {draft.customAiChecks.length < MAX_CUSTOM_QUALITY_CHECKS ? (
                      <>
                        <Link onClick={() => setDraft(addCustomCheck(draft))}>
                          + Add custom check
                        </Link>{" "}
                        <Text size="sm" color="text-low">
                          Name it, describe what to evaluate — it joins this
                          section&apos;s split.
                        </Text>
                      </>
                    ) : (
                      <Text size="sm" color="text-low">
                        Up to {MAX_CUSTOM_QUALITY_CHECKS} custom checks per
                        configuration.
                      </Text>
                    )}
                  </Box>
                )}
              </>
            )}
          </div>
        );
      })}
    </Box>
  );

  return (
    <Box>
      {createModalOpen && (
        <ModalStandard
          open
          trackingEventModalType="create-experiment-quality-config"
          header="Create Quality Config"
          cta="Create"
          ctaEnabled={!!createName.trim()}
          close={() => setCreateModalOpen(false)}
          submit={async () => {
            await createConfig(createName.trim(), draftToConfig(draft));
            setCreateModalOpen(false);
            setCreateName("");
          }}
        >
          <Field
            label="Config name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="e.g. Growth team standards"
          />
          <Text size="sm" color="text-mid">
            Starts from the configuration currently shown. The{" "}
            {scope === "org" ? "organization default" : "Project"} will point at
            the new config.
          </Text>
        </ModalStandard>
      )}

      {deleteConfirmOpen && selectedConfig && (
        <ModalStandard
          open
          trackingEventModalType="delete-experiment-quality-config"
          header="Delete Quality Config"
          cta="Delete"
          ctaColor="red"
          close={() => setDeleteConfirmOpen(false)}
          submit={deleteConfig}
        >
          <p>
            Delete <Text weight="semibold">{selectedConfig.name}</Text>? Scopes
            using it fall back to the GrowthBook default. Deletion is refused
            while another scope still references it.
          </p>
        </ModalStandard>
      )}

      {/* Header */}
      <Flex align="start" justify="between" gap="4">
        <Box>
          <Flex align="center" gap="2">
            <Heading as="h1" size="lg" mb="0">
              Experiment Quality
            </Heading>
            <PremiumTooltip
              commercialFeature="experiment-quality-score"
              style={{ display: "inline-flex" }}
            />
          </Flex>
          <Box mt="1">
            <Text size="md" color="text-mid">
              Score every experiment 0&ndash;100 on completeness and
              trustworthiness. The score appears on the Learnings page and feeds
              experimentation health.
            </Text>
          </Box>
        </Box>
        {scope === "org" && (
          <Box flexShrink="0">
            <Switch
              value={orgEnabled}
              onChange={(v) => setOrgPointer({ enabled: v })}
              label="Enabled"
              disabled={!hasFeature || !canEditPointer}
            />
          </Box>
        )}
      </Flex>

      {/* Controls row */}
      <Flex
        align="center"
        gap="3"
        mt="4"
        mb={scope === "org" ? "1" : "4"}
        wrap="wrap"
      >
        <Flex align="center" gap="1">
          <Text size="sm" color="text-mid">
            Scope:
          </Text>
          <Select value={scope} setValue={(v) => setScope(v)} size="sm">
            <SelectItem value="org">Organization default</SelectItem>
            {projects.length > 0 && (
              <SelectGroup>
                <SelectLabel>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "var(--color-text-low)",
                    }}
                  >
                    Projects
                  </span>
                </SelectLabel>
                {projects.map((p) => {
                  const pointer = p.settings?.experimentQuality;
                  const pointedConfig = pointer?.configId
                    ? experimentQualityConfigs.find(
                        (c) => c.id === pointer.configId,
                      )
                    : undefined;
                  const scoringDisabled = pointer?.enabled === false;
                  const pill = scoringDisabled
                    ? { label: "Disabled", color: "gray" as const }
                    : pointedConfig
                      ? { label: pointedConfig.name, color: "violet" as const }
                      : pointer?.enabled === true
                        ? { label: "Enabled", color: "violet" as const }
                        : null;
                  return (
                    <SelectItem key={p.id} value={p.id}>
                      <Flex
                        align="center"
                        gap="3"
                        justify="between"
                        width="100%"
                        pl="2"
                      >
                        <span
                          className={scoringDisabled ? "text-muted" : undefined}
                        >
                          {p.name}
                        </span>
                        {pill && (
                          <Badge
                            label={pill.label}
                            color={pill.color}
                            variant="soft"
                            radius="full"
                            size="xs"
                          />
                        )}
                      </Flex>
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            )}
          </Select>
        </Flex>
        {scope !== "org" && (
          <Flex align="center" gap="1">
            <Text size="sm" color="text-mid">
              Scoring:
            </Text>
            <Select
              value={
                projectPointer?.enabled === undefined
                  ? "inherit"
                  : projectPointer.enabled
                    ? "on"
                    : "off"
              }
              setValue={(v) =>
                setProjectPointer({
                  enabled: v === "inherit" ? undefined : v === "on",
                })
              }
              size="sm"
              disabled={!canEditPointer}
            >
              <SelectItem value="inherit">Inherit org setting</SelectItem>
              <SelectItem value="on">Enabled</SelectItem>
              <SelectItem value="off">Disabled</SelectItem>
            </Select>
          </Flex>
        )}
        <Flex align="center" gap="1">
          <Text size="sm" color="text-mid">
            Config:
          </Text>
          <Select
            value={
              scope !== "org" && !projectPointer?.configId
                ? "inherit-config"
                : configSelectValue
            }
            setValue={async (v) => {
              if (v === CREATE_CONFIG_VALUE) {
                setCreateModalOpen(true);
                return;
              }
              if (scope === "org") {
                await setOrgPointer({
                  configId: v === DEFAULT_CONFIG_VALUE ? null : v,
                });
              } else {
                if (v === "inherit-config") {
                  await setProjectPointer({ clearConfigId: true });
                } else if (v === DEFAULT_CONFIG_VALUE) {
                  // Projects can't unset the org's config; inherit covers it
                  await setProjectPointer({ clearConfigId: true });
                } else {
                  await setProjectPointer({ configId: v });
                }
              }
            }}
            size="sm"
            disabled={!canEditPointer}
          >
            {scope === "org" ? (
              <SelectItem value={DEFAULT_CONFIG_VALUE}>
                GrowthBook default
              </SelectItem>
            ) : (
              <SelectItem value="inherit-config">Inherit org config</SelectItem>
            )}
            {experimentQualityConfigs.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
            {canManageConfigs && (
              <SelectItem value={CREATE_CONFIG_VALUE}>
                + Create new config…
              </SelectItem>
            )}
          </Select>
        </Flex>
        {selectedConfig && canManageConfigs && (
          <Box ml="auto">
            <Button
              variant="ghost"
              onClick={() => setDeleteConfirmOpen(true)}
              aria-label="Delete this config"
            >
              <Flex align="center" gap="1">
                <PiTrash /> <span>Delete config</span>
              </Flex>
            </Button>
          </Box>
        )}
      </Flex>
      {scope === "org" && (
        <Box mb="4">
          <Text size="sm" color="text-low">
            Applies to every Project without an override
          </Text>
        </Box>
      )}

      {scope === "org" && !effectiveEnabled && (
        <Callout status="info" mb="4">
          Quality scoring is off.{" "}
          {canEditPointer ? (
            <Link onClick={() => setOrgPointer({ enabled: true })}>
              Turn on
            </Link>
          ) : (
            "Turn on Enabled"
          )}{" "}
          to score experiments and show badges on the Learnings page.
        </Callout>
      )}

      {/* Config editor */}
      <Box className={clsx(!effectiveEnabled ? styles.ghosted : undefined)}>
        <Box mb="4" style={{ maxWidth: 480 }}>
          <Field
            label="Config name"
            value={draft.name}
            disabled={!canEditConfig}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            helpText={
              isVirtualDefault
                ? `Currently the built-in GrowthBook default. Saving edits creates a config with this name and applies it to ${
                    scope === "org"
                      ? "the organization default"
                      : "this Project"
                  }.`
                : undefined
            }
          />
        </Box>

        <Box mb="4">{editor}</Box>

        {/* Recalculate */}
        <Flex align="center" justify="between" gap="3" mb="2">
          <Text size="sm" color="text-mid">
            AI changes apply to new verdicts only. Re-score existing experiments
            —{" "}
            <Text weight="semibold">
              {statusData?.stoppedExperiments ?? "…"} stopped
            </Text>{" "}
            · uses AI tokens.
          </Text>
          <Button
            variant="outline"
            disabled={dirty}
            title={
              dirty
                ? "Save your changes first — recalculation uses the saved settings"
                : undefined
            }
            onClick={async () => {
              setRecalculateStatus("");
              const res = await apiCall<{ status: number; queued: number }>(
                "/experiment-quality-score/recalculate",
                { method: "POST" },
              );
              setRecalculateStatus(
                `Queued ${res.queued} experiment${res.queued === 1 ? "" : "s"} for AI re-scoring. Verdicts update in the background.`,
              );
            }}
          >
            Recalculate AI verdicts
          </Button>
        </Flex>
        {recalculateStatus && (
          <HelperText status="success" size="sm" mb="2">
            {recalculateStatus}
          </HelperText>
        )}

        <Callout status="info">
          Changes to the quality checks and weights will re-score all
          non-archived experiments
        </Callout>
      </Box>

      {/* Sticky save bar — same pattern as the main settings page */}
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
          <Button
            disabled={
              !dirty || degenerate || invalidCustomChecks || !canEditConfig
            }
            setError={(e) => setSaveError(e ?? "")}
            onClick={saveConfig}
          >
            Save
          </Button>
        </Flex>
      </Box>
    </Box>
  );
}
