import React, { ReactNode, useState } from "react";
import { Box, Flex, Tooltip } from "@radix-ui/themes";
import clsx from "clsx";
import { PiCaretRightBold, PiTrash } from "react-icons/pi";
import {
  EXPERIMENT_QUALITY_CHECKS,
  EXPERIMENT_QUALITY_SECTIONS,
  getChecksForSection,
} from "shared/enterprise";
import {
  ExperimentQualityCheckKey,
  MAX_CUSTOM_QUALITY_CHECKS,
  experimentQualitySectionKeys,
} from "shared/validators";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import { SECTION_COLORS } from "@/components/Experiment/Quality/qualityDisplay";
import ShareBar from "./ShareBar";
import {
  QualityConfigDraft,
  addCustomCheck,
  countEnabledChecks,
  getEnabledSectionKeys,
  reflowSectionWeights,
  removeCustomCheck,
  setSectionEnabled,
  updateCheck,
  updateCustomCheck,
} from "./qualityConfigDraft";
import styles from "./ExperimentQuality.module.scss";

const AI_CONTEXT_PLACEHOLDER =
  "Add guidance for the AI judge, e.g. what a good one looks like at your org";

// The row shared by built-in checks and custom AI rules: checkbox and
// label area, with an optional text field below
function CheckRow({
  id,
  enabled,
  disabled,
  label,
  below,
  onToggle,
}: {
  id: string;
  enabled: boolean;
  // The whole section is switched off
  disabled: boolean;
  label: ReactNode;
  below?: ReactNode;
  onToggle: (v: boolean) => void;
}) {
  const isOn = enabled && !disabled;
  return (
    <Box py="2" style={{ opacity: isOn ? 1 : 0.5 }}>
      <div className={styles.checkRow}>
        <Checkbox
          mb="0"
          value={enabled}
          setValue={onToggle}
          id={id}
          disabled={disabled}
        />
        <Flex align="center" gap="2" wrap="wrap">
          {label}
        </Flex>
      </div>
      {isOn && below && (
        <Box mt="1" mb="1" ml="6" pl="1">
          {below}
        </Box>
      )}
    </Box>
  );
}

function ParamInput({
  value,
  min,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: number;
  min: number;
  disabled: boolean;
  ariaLabel: string;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      className={styles.paramInput}
      min={min}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(parseInt(e.target.value))}
    />
  );
}

function CheckLabel({
  checkKey,
  draft,
  disabled,
  onChange,
}: {
  checkKey: ExperimentQualityCheckKey;
  draft: QualityConfigDraft;
  disabled: boolean;
  onChange: (draft: QualityConfigDraft) => void;
}) {
  const def = EXPERIMENT_QUALITY_CHECKS[checkKey];
  const check = draft.checks[checkKey];
  const inputDisabled = !check.enabled || disabled;
  const setParam = (params: Record<string, number>) =>
    onChange(
      updateCheck(draft, checkKey, { params: { ...check.params, ...params } }),
    );
  return (
    <>
      <label htmlFor={`quality-check-${checkKey}`} className="mb-0">
        <Text size="md">{def.label}</Text>
      </label>
      {checkKey === "goal-metrics" && (
        <Flex align="center" gap="1">
          <Text size="sm" color="text-mid">
            · fewer than
          </Text>
          <ParamInput
            value={check.params?.maxGoalMetrics ?? 3}
            min={2}
            disabled={inputDisabled}
            ariaLabel="Maximum goal metrics"
            onChange={(v) => setParam({ maxGoalMetrics: v })}
          />
        </Flex>
      )}
      {checkKey === "no-early-stop" && (
        <Flex align="center" gap="1">
          <Text size="sm" color="text-mid">
            · before the scheduled end, or before
          </Text>
          <ParamInput
            value={check.params?.minRuntimeDays ?? 14}
            min={1}
            disabled={inputDisabled}
            ariaLabel="Minimum runtime in days when there's no scheduled end"
            onChange={(v) => setParam({ minRuntimeDays: v })}
          />
          <Text size="sm" color="text-mid">
            days without one
          </Text>
        </Flex>
      )}
      {def.note && (
        <Text size="sm" color="text-low">
          · {def.note}
        </Text>
      )}
    </>
  );
}

function FieldBelow({
  label,
  optional,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  optional?: boolean;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <Text size="sm" weight="medium" color="text-mid" as="p" mb="1">
        {label}
        {optional && <Text color="text-low"> (optional)</Text>}
      </Text>
      <Field
        textarea
        minRows={1}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  );
}

export default function QualityConfigEditor({
  draft,
  setDraft,
  aiAvailable,
  hypothesisDefinition,
  aiSectionFooter,
}: {
  draft: QualityConfigDraft;
  setDraft: (draft: QualityConfigDraft) => void;
  aiAvailable: boolean;
  hypothesisDefinition: string;
  // Rendered at the bottom of the open AI checks section
  aiSectionFooter?: ReactNode;
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  const enabledSectionKeys = getEnabledSectionKeys(draft);
  const stripSections = enabledSectionKeys.filter(
    (k) => k !== "ai" || aiAvailable,
  );
  const stripTotal = stripSections.reduce(
    (sum, k) => sum + draft.sections[k].weight,
    0,
  );

  return (
    <Box>
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
        const section = EXPERIMENT_QUALITY_SECTIONS[sectionKey];
        const color = SECTION_COLORS[sectionKey];
        const isAI = sectionKey === "ai";
        const sectionOn = enabledSectionKeys.includes(sectionKey);
        const open = openSections.has(sectionKey);
        const share = sectionOn ? draft.sections[sectionKey].weight : 0;
        const aiParked = isAI && !aiAvailable;
        const included = draft.sectionEnabled[sectionKey];
        const enabledCount = countEnabledChecks(draft, sectionKey);

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
                    setOpenSections((s) => {
                      const next = new Set(s);
                      if (!next.delete(sectionKey)) next.add(sectionKey);
                      return next;
                    })
                  }
                  aria-expanded={open}
                  aria-label={`Toggle the ${section.label} section`}
                >
                  <PiCaretRightBold
                    size={12}
                    className={clsx(styles.chevron, open && styles.open)}
                  />
                  <span
                    className={styles.sectionLabel}
                    style={{ color: color.text }}
                  >
                    {section.label}
                  </span>
                </button>
                {aiParked ? (
                  <Text size="sm" color="text-low">
                    Not running ·{" "}
                    <Link href="/settings#ai">Go to AI settings</Link>
                  </Text>
                ) : open ? (
                  section.note && (
                    <Text size="sm" color="text-low">
                      · {section.note}
                    </Text>
                  )
                ) : (
                  <Text size="sm" color="text-low">
                    · {enabledCount} {enabledCount === 1 ? "check" : "checks"}
                  </Text>
                )}
                {/* Only the AI section is switched on and off as a whole; a
                    saved config that turned off another section can still
                    turn it back on */}
                {!aiParked && (isAI || !included) && (
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
                    ariaLabel={`${section.label}, ${share}% of score`}
                  />
                )}
              </Box>
              <span
                className={clsx(
                  styles.sectionShare,
                  !(sectionOn && !aiParked) && styles.off,
                )}
              >
                {sectionOn && !aiParked ? `${share}%` : "—"}
              </span>
            </div>

            {open && !aiParked && (
              <>
                {getChecksForSection(sectionKey).map((checkKey) => {
                  const check = draft.checks[checkKey];
                  return (
                    <CheckRow
                      key={checkKey}
                      id={`quality-check-${checkKey}`}
                      enabled={check.enabled}
                      disabled={!included}
                      label={
                        <CheckLabel
                          checkKey={checkKey}
                          draft={draft}
                          disabled={!included}
                          onChange={setDraft}
                        />
                      }
                      below={
                        isAI && (
                          <FieldBelow
                            label="Context"
                            optional
                            placeholder={AI_CONTEXT_PLACEHOLDER}
                            value={
                              check.aiContext ??
                              (checkKey === "ai-hypothesis-quality"
                                ? hypothesisDefinition
                                : "")
                            }
                            onChange={(aiContext) =>
                              setDraft(
                                updateCheck(draft, checkKey, { aiContext }),
                              )
                            }
                          />
                        )
                      }
                      onToggle={(enabled) =>
                        setDraft(updateCheck(draft, checkKey, { enabled }))
                      }
                    />
                  );
                })}
                {isAI &&
                  draft.customAiChecks.map((custom) => (
                    <CheckRow
                      key={custom.id}
                      id={`quality-custom-check-${custom.id}`}
                      enabled={custom.enabled}
                      disabled={!included}
                      label={
                        <>
                          <input
                            type="text"
                            className={clsx(
                              styles.paramInput,
                              styles.nameInput,
                            )}
                            placeholder="Name this check"
                            value={custom.name}
                            disabled={!custom.enabled || !included}
                            aria-label="Custom check name"
                            onChange={(e) =>
                              setDraft(
                                updateCustomCheck(draft, custom.id, {
                                  name: e.target.value,
                                }),
                              )
                            }
                          />
                          <Badge
                            label="Custom"
                            color="violet"
                            variant="soft"
                            size="xs"
                          />
                          <Tooltip content="Remove this custom check">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDraft(removeCustomCheck(draft, custom.id))
                              }
                              aria-label="Remove custom check"
                            >
                              <PiTrash />
                            </Button>
                          </Tooltip>
                        </>
                      }
                      below={
                        <FieldBelow
                          label="What to evaluate"
                          placeholder='Describe how to score this from the experiment data, e.g. "start with 10 points and take off 2 for every goal metric beyond 5"'
                          value={custom.rule}
                          onChange={(rule) =>
                            setDraft(
                              updateCustomCheck(draft, custom.id, { rule }),
                            )
                          }
                        />
                      }
                      onToggle={(enabled) =>
                        setDraft(
                          updateCustomCheck(draft, custom.id, { enabled }),
                        )
                      }
                    />
                  ))}
                {isAI && (
                  <Box py="2" className={styles.addCustomRow}>
                    {draft.customAiChecks.length < MAX_CUSTOM_QUALITY_CHECKS ? (
                      <>
                        <Link onClick={() => setDraft(addCustomCheck(draft))}>
                          + Add custom check
                        </Link>{" "}
                        <Text size="sm" color="text-low">
                          Name it and describe what to evaluate — it counts the
                          same as the other checks here.
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
