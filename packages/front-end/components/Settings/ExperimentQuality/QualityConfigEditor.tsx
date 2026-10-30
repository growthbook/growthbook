import React, { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus, PiTrash } from "react-icons/pi";
import {
  EXPERIMENT_QUALITY_CHECKS,
  EXPERIMENT_QUALITY_SECTIONS,
  getChecksForSection,
} from "shared/enterprise";
import {
  ExperimentQualityCheckKey,
  ExperimentQualityCheckParams,
  ExperimentQualitySectionKey,
  MAX_CUSTOM_QUALITY_CHECKS,
  experimentQualitySectionKeys,
} from "shared/validators";
import isEqual from "lodash/isEqual";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Switch from "@/ui/Switch";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import SectionWeights from "./SectionWeights";
import { ChangedDot, DefaultHint } from "./ChangeMarkers";
import { NumberInput } from "./PercentInput";
import {
  QualityConfigDraft,
  addCustomCheck,
  isSectionChanged,
  removeCustomCheck,
  resetSection,
  setCustomCheckJudge,
  setSectionEnabled,
  updateCheck,
  updateCustomCheck,
} from "./qualityConfigDraft";
import styles from "./ExperimentQuality.module.scss";

const AI_CONTEXT_PLACEHOLDER =
  "Add guidance for the AI, e.g. what a good one looks like at your org";

const JUDGE_LABELS = {
  decision: "Decision model (fast)",
  llm: "AI model",
};

// The inline number some checks take, as words around a box
const PARAMS: Partial<
  Record<
    ExperimentQualityCheckKey,
    {
      param: keyof ExperimentQualityCheckParams;
      before: string;
      after?: string;
      min: number;
      fallback: number;
      ariaLabel: string;
      unit: string;
    }
  >
> = {
  "goal-metrics": {
    param: "maxGoalMetrics",
    before: "fewer than",
    min: 2,
    fallback: 3,
    ariaLabel: "Maximum goal metrics",
    unit: "",
  },
  "max-variations": {
    param: "maxVariations",
    before: "at most",
    after: "including control",
    min: 2,
    fallback: 4,
    ariaLabel: "Maximum variations, including control",
    unit: "",
  },
  "no-early-stop": {
    param: "minRuntimeDays",
    before: "before",
    after: "days with no end date",
    min: 1,
    fallback: 14,
    ariaLabel: "Minimum runtime in days when there's no end date",
    unit: " days",
  },
};

function CheckRow({
  checkKey,
  draft,
  base,
  disabled,
  setDraft,
  below,
}: {
  checkKey: ExperimentQualityCheckKey;
  draft: QualityConfigDraft;
  base?: QualityConfigDraft;
  disabled: boolean;
  setDraft: (draft: QualityConfigDraft) => void;
  below?: ReactNode;
}) {
  const def = EXPERIMENT_QUALITY_CHECKS[checkKey];
  const check = draft.checks[checkKey];
  const param = PARAMS[checkKey];
  const value = param ? (check.params?.[param.param] ?? param.fallback) : null;
  const baseCheck = base?.checks[checkKey];
  const baseValue =
    param && baseCheck
      ? (baseCheck.params?.[param.param] ?? param.fallback)
      : null;
  const enabledChanged = !!baseCheck && baseCheck.enabled !== check.enabled;
  const paramChanged = !!param && !!baseCheck && baseValue !== value;
  const contextChanged =
    !!baseCheck &&
    (baseCheck.aiContext?.trim() ?? "") !== (check.aiContext?.trim() ?? "");
  const id = `quality-check-${checkKey}`;

  return (
    <Box className={styles.checkRow}>
      <Flex align="center" gap="3" wrap="wrap">
        <Checkbox
          mb="0"
          id={id}
          value={check.enabled}
          disabled={disabled}
          setValue={(enabled) =>
            setDraft(updateCheck(draft, checkKey, { enabled }))
          }
        />
        <Flex align="center" gap="2" wrap="wrap" flexGrow="1">
          {enabledChanged || paramChanged || contextChanged ? (
            <ChangedDot />
          ) : null}
          <label htmlFor={id} style={{ margin: 0 }}>
            <Text>{def.label}</Text>
          </label>
          {param && value !== null ? (
            <Flex align="center" gap="2">
              <Text color="text-mid">{param.before}</Text>
              <NumberInput
                value={value}
                min={param.min}
                disabled={disabled || !check.enabled}
                ariaLabel={param.ariaLabel}
                onChange={(v) =>
                  setDraft(
                    updateCheck(draft, checkKey, {
                      params: { ...check.params, [param.param]: v },
                    }),
                  )
                }
              />
              {param.after ? <Text color="text-mid">{param.after}</Text> : null}
            </Flex>
          ) : null}
          {def.note ? <span className={styles.chip}>{def.note}</span> : null}
          {enabledChanged && baseCheck ? (
            <DefaultHint value={baseCheck.enabled ? "on" : "off"} />
          ) : paramChanged && param ? (
            <DefaultHint value={`${baseValue}${param.unit}`} />
          ) : null}
        </Flex>
      </Flex>
      {below && check.enabled && !disabled ? (
        <Box mt="2" ml="6" pl="1">
          {below}
        </Box>
      ) : null}
    </Box>
  );
}

function TextBelow({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: ReactNode;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <Text as="p" size="sm" color="text-mid" mb="1">
        {label}
      </Text>
      <Field
        textarea
        minRows={2}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  );
}

function SectionCard({
  sectionKey,
  draft,
  base,
  setDraft,
  aiAvailable,
  decisionModelAvailable,
  hypothesisDefinition,
  readOnly,
}: {
  sectionKey: ExperimentQualitySectionKey;
  draft: QualityConfigDraft;
  base?: QualityConfigDraft;
  setDraft: (draft: QualityConfigDraft) => void;
  aiAvailable: boolean;
  decisionModelAvailable: boolean;
  hypothesisDefinition: string;
  readOnly: boolean;
}) {
  const section = EXPERIMENT_QUALITY_SECTIONS[sectionKey];
  const isAI = sectionKey === "ai";
  const aiOff = isAI && !aiAvailable;
  const included = draft.sectionEnabled[sectionKey];
  const changed = !!base && isSectionChanged(draft, base, sectionKey);
  const rowsDisabled = readOnly || !included || aiOff;

  return (
    <Box className={styles.sectionCard}>
      <Flex
        className={styles.sectionHeader}
        justify="between"
        align="start"
        gap="3"
      >
        <Box>
          <Flex align="center" gap="3">
            {base && base.sectionEnabled[sectionKey] !== included ? (
              <ChangedDot />
            ) : null}
            <Text weight="semibold" size="lg">
              {section.label}
            </Text>
            <Switch
              aria-label={`Include ${section.label}`}
              value={included && !aiOff}
              disabled={readOnly || aiOff}
              onChange={(v) =>
                setDraft(setSectionEnabled(draft, sectionKey, v))
              }
            />
          </Flex>
          <Text as="p" size="sm" color="text-mid" mt="1" mb="0">
            {aiOff ? (
              <>
                AI is off for the organization.{" "}
                <Link href="/settings#ai">Go to AI settings</Link>
              </>
            ) : (
              section.note
            )}
          </Text>
        </Box>
        {changed && base && !readOnly ? (
          <Link onClick={() => setDraft(resetSection(draft, base, sectionKey))}>
            Reset to organization default
          </Link>
        ) : null}
      </Flex>
      {getChecksForSection(sectionKey).map((checkKey) => (
        <CheckRow
          key={checkKey}
          checkKey={checkKey}
          draft={draft}
          base={base}
          disabled={rowsDisabled}
          setDraft={setDraft}
          below={
            isAI ? (
              <TextBelow
                label={
                  <>
                    Context <Text color="text-low">(optional)</Text>
                  </>
                }
                placeholder={AI_CONTEXT_PLACEHOLDER}
                value={
                  draft.checks[checkKey].aiContext ??
                  (checkKey === "ai-hypothesis-quality"
                    ? hypothesisDefinition
                    : "")
                }
                onChange={(aiContext) =>
                  setDraft(updateCheck(draft, checkKey, { aiContext }))
                }
              />
            ) : null
          }
        />
      ))}
      {isAI
        ? draft.customAiChecks.map((custom) => {
            const baseCustom = base?.customAiChecks.find(
              (c) => c.id === custom.id,
            );
            const customChanged =
              !!base &&
              (!baseCustom ||
                !isEqual(
                  [baseCustom.name, baseCustom.rule, baseCustom.enabled],
                  [custom.name, custom.rule, custom.enabled],
                ));
            return (
              <Box key={custom.id} className={styles.checkRow}>
                <Flex align="center" gap="3">
                  <Checkbox
                    mb="0"
                    value={custom.enabled}
                    disabled={rowsDisabled}
                    setValue={(enabled) =>
                      setDraft(updateCustomCheck(draft, custom.id, { enabled }))
                    }
                  />
                  {customChanged ? <ChangedDot /> : null}
                  <TextField
                    size="sm"
                    style={{ width: 240 }}
                    placeholder="Name this check"
                    value={custom.name}
                    disabled={rowsDisabled}
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
                  {!readOnly ? (
                    <Tooltip content="Remove this custom check">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Remove custom check"
                        onClick={() =>
                          setDraft(removeCustomCheck(draft, custom.id))
                        }
                      >
                        <PiTrash />
                      </Button>
                    </Tooltip>
                  ) : null}
                </Flex>
                {custom.enabled && !rowsDisabled ? (
                  <Box mt="2" ml="6" pl="1">
                    <TextBelow
                      label="What to evaluate"
                      placeholder='Describe how to score this from the experiment data, e.g. "start with 10 points and take off 2 for every goal metric beyond 5"'
                      value={custom.rule}
                      onChange={(rule) =>
                        setDraft(updateCustomCheck(draft, custom.id, { rule }))
                      }
                    />
                    {decisionModelAvailable ? (
                      <Flex align="center" gap="2" wrap="wrap" mt="2">
                        <Text size="sm" color="text-mid">
                          Judged by
                        </Text>
                        <Select
                          size="sm"
                          aria-label="Judged by"
                          value={
                            custom.judgeChosenBy === "admin" && custom.judge
                              ? custom.judge
                              : "auto"
                          }
                          setValue={(v) =>
                            setDraft(
                              setCustomCheckJudge(
                                draft,
                                custom.id,
                                v === "decision" || v === "llm" ? v : null,
                              ),
                            )
                          }
                        >
                          <SelectItem value="auto">
                            Choose automatically
                          </SelectItem>
                          <SelectItem value="decision">
                            {JUDGE_LABELS.decision}
                          </SelectItem>
                          <SelectItem value="llm">
                            {JUDGE_LABELS.llm}
                          </SelectItem>
                        </Select>
                        {custom.judgeChosenBy !== "admin" ? (
                          <Text size="sm" color="text-low">
                            {custom.judge
                              ? `Picked automatically: ${JUDGE_LABELS[custom.judge]}.`
                              : "Picked when you save."}
                          </Text>
                        ) : null}
                      </Flex>
                    ) : null}
                  </Box>
                ) : null}
              </Box>
            );
          })
        : null}
      {isAI && !rowsDisabled ? (
        <Box className={styles.checkRow}>
          {draft.customAiChecks.length < MAX_CUSTOM_QUALITY_CHECKS ? (
            <Link onClick={() => setDraft(addCustomCheck(draft))}>
              <Flex align="center" gap="1" display="inline-flex">
                <PiPlus />
                Add custom check
              </Flex>
            </Link>
          ) : (
            <Text size="sm" color="text-low">
              Up to {MAX_CUSTOM_QUALITY_CHECKS} custom checks.
            </Text>
          )}
        </Box>
      ) : null}
    </Box>
  );
}

export default function QualityConfigEditor({
  draft,
  setDraft,
  base,
  aiAvailable,
  decisionModelAvailable,
  hypothesisDefinition,
  readOnly = false,
}: {
  draft: QualityConfigDraft;
  setDraft: (draft: QualityConfigDraft) => void;
  // The organization default, on a Project's page
  base?: QualityConfigDraft;
  aiAvailable: boolean;
  // Custom checks can be routed to a decision model instead of the AI model
  decisionModelAvailable: boolean;
  hypothesisDefinition: string;
  readOnly?: boolean;
}) {
  return (
    <Box>
      <SectionWeights
        draft={draft}
        setDraft={setDraft}
        base={base}
        unavailable={aiAvailable ? [] : ["ai"]}
        disabled={readOnly}
      />
      <Flex direction="column" gap="4">
        {experimentQualitySectionKeys.map((sectionKey) => (
          <SectionCard
            key={sectionKey}
            sectionKey={sectionKey}
            draft={draft}
            base={base}
            setDraft={setDraft}
            aiAvailable={aiAvailable}
            decisionModelAvailable={decisionModelAvailable}
            hypothesisDefinition={hypothesisDefinition}
            readOnly={readOnly}
          />
        ))}
      </Flex>
    </Box>
  );
}
