import React, { ReactNode, useState } from "react";
import { Box, Flex, Tooltip } from "@radix-ui/themes";
import clsx from "clsx";
import { PiCaretRightBold, PiTrash } from "react-icons/pi";
import {
  EXPERIMENT_QUALITY_CHECKS,
  EXPERIMENT_QUALITY_SECTIONS,
  ExperimentQualityCheckKey,
  ExperimentQualitySectionKey,
  MAX_CUSTOM_QUALITY_CHECKS,
  experimentQualitySectionKeys,
  getChecksForSection,
} from "shared/enterprise";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import ShareBar from "./ShareBar";
import {
  QualityConfigDraft,
  addCustomCheck,
  getEnabledSectionKeys,
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
  results: "· stopped experiments only",
  health: "· when traffic data exists",
  ai: "· judged by AI, cached until inputs change",
};

const CHECK_QUALIFIERS: Partial<Record<ExperimentQualityCheckKey, string>> = {
  screenshots: "· all except Holdouts",
  "health-no-issues": "· SRM, multiple exposures, imbalance",
  "min-runtime": "· stopped only",
  "ai-hypothesis-quality": "· hypothesis present",
  "ai-learnings-quality": "· stopped, learnings present",
};

const AI_CONTEXT_PLACEHOLDER =
  "Add guidance for the AI judge, e.g. what a good one looks like at your org";

function SplitCell({
  isOn,
  split,
  overall,
}: {
  isOn: boolean;
  split: number;
  overall: number;
}) {
  return (
    <Box style={{ textAlign: "right", lineHeight: 1.25 }}>
      <span
        style={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          color: isOn ? "var(--color-text-high)" : "var(--color-text-low)",
        }}
      >
        {isOn ? `${split}%` : "—"}
      </span>
      <br />
      <span style={{ fontSize: 10, color: "var(--color-text-low)" }}>
        {isOn ? `≈${overall}% overall` : "excluded"}
      </span>
    </Box>
  );
}

function EmptyTrack() {
  return <span className={styles.emptyTrack} />;
}

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
          <EmptyTrack />
        )}
        <SplitCell isOn={isOn} split={check.weight} overall={overall} />
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
          <Badge label="Custom" color="violet" variant="soft" size="xs" />
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
          <EmptyTrack />
        )}
        <SplitCell isOn={isOn} split={custom.weight} overall={overall} />
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

function countEnabledChecks(
  draft: QualityConfigDraft,
  sectionKey: ExperimentQualitySectionKey,
): number {
  const builtIn = getChecksForSection(sectionKey).filter(
    (k) => draft.checks[k].enabled,
  ).length;
  const custom =
    sectionKey === "ai"
      ? draft.customAiChecks.filter((c) => c.enabled).length
      : 0;
  return builtIn + custom;
}

export default function QualityConfigEditor({
  draft,
  setDraft,
  aiAvailable,
  readOnly,
  hypothesisDefinition,
  aiSectionFooter,
}: {
  draft: QualityConfigDraft;
  setDraft: (draft: QualityConfigDraft) => void;
  aiAvailable: boolean;
  readOnly: boolean;
  hypothesisDefinition: string;
  // Rendered at the bottom of the open AI checks section
  aiSectionFooter?: ReactNode;
}) {
  const [openSections, setOpenSections] = useState<
    Record<ExperimentQualitySectionKey, boolean>
  >({ documentation: false, results: false, health: false, ai: false });

  const enabledSectionKeys = getEnabledSectionKeys(draft);
  const stripSections = enabledSectionKeys.filter(
    (k) => k !== "ai" || aiAvailable,
  );
  const stripTotal = stripSections.reduce(
    (sum, k) => sum + draft.sections[k].weight,
    0,
  );

  return (
    <Box className={clsx(readOnly && styles.ghosted)}>
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

      {experimentQualitySectionKeys.map((sectionKey) => {
        const color = SECTION_COLORS[sectionKey];
        const isAI = sectionKey === "ai";
        const sectionOn = enabledSectionKeys.includes(sectionKey);
        const open = openSections[sectionKey];
        const share = sectionOn ? draft.sections[sectionKey].weight : 0;
        const aiParked = isAI && !aiAvailable;
        const included = isAI
          ? draft.aiChecksEnabled
          : draft.sectionEnabled[sectionKey];
        const enabledCount = countEnabledChecks(draft, sectionKey);
        // Only the AI section is switched on and off as a whole; a stored
        // config that turned off another section can still turn it back on
        const showIncludedSwitch = !aiParked && (isAI || !included);

        return (
          <div key={sectionKey} className={styles.sectionPanel}>
            <div
              className={clsx(
                styles.sectionHeader,
                open && !aiParked && styles.withBorder,
              )}
            >
              <Flex align="center" gap="2" wrap="wrap">
                <button
                  type="button"
                  className={styles.sectionToggle}
                  onClick={() =>
                    setOpenSections((s) => ({
                      ...s,
                      [sectionKey]: !s[sectionKey],
                    }))
                  }
                  aria-expanded={open}
                  aria-label={`Toggle the ${EXPERIMENT_QUALITY_SECTIONS[sectionKey].label} section`}
                >
                  <PiCaretRightBold
                    size={12}
                    className={clsx(styles.chevron, open && styles.open)}
                  />
                  <span
                    style={{ color: color.text, fontSize: 13, fontWeight: 600 }}
                  >
                    {EXPERIMENT_QUALITY_SECTIONS[sectionKey].label}
                  </span>
                </button>
                {aiParked ? (
                  <Text size="sm" color="text-low">
                    Not running ·{" "}
                    <Link href="/settings#ai">Go to AI settings</Link>
                  </Text>
                ) : open ? (
                  SECTION_NOTES[sectionKey] && (
                    <Text size="sm" color="text-low">
                      {SECTION_NOTES[sectionKey]}
                    </Text>
                  )
                ) : (
                  <Text size="sm" color="text-low">
                    · {enabledCount} {enabledCount === 1 ? "check" : "checks"}
                  </Text>
                )}
                {showIncludedSwitch && (
                  <Switch
                    size="sm"
                    label="Included"
                    value={included}
                    onChange={(v) =>
                      setDraft(setSectionEnabled(draft, sectionKey, v))
                    }
                  />
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
                    ariaLabel={`${EXPERIMENT_QUALITY_SECTIONS[sectionKey].label}, ${share}% of score`}
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
                    disabled={!included}
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
                {isAI && aiSectionFooter}
              </>
            )}
          </div>
        );
      })}
    </Box>
  );
}
