import React, { FC } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import type {
  DecisionCriteriaData,
  DecisionCriteriaAction,
  DecisionCriteriaCondition,
  DcHealthSignalAction,
  DcHealthSignals,
} from "shared/enterprise";
import { DEFAULT_DC_HEALTH_SIGNALS } from "shared/enterprise";
import { FaPlusCircle } from "react-icons/fa";
import {
  PiArrowDown,
  PiArrowUp,
  PiCheck,
  PiEye,
  PiMinusCircle,
  PiProhibit,
  PiTrash,
} from "react-icons/pi";
import { Select, SelectItem } from "@/ui/Select";
import { useDecisionCriteriaForm } from "@/hooks/useDecisionCriteriaForm";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";

// Match options
const MATCH_OPTIONS = [
  { value: "all", label: "All" },
  { value: "any", label: "Any" },
  { value: "none", label: "No" },
];

// Metrics options
const METRICS_OPTIONS = [
  { value: "goals", label: "Goals" },
  { value: "guardrails", label: "Guardrails" },
];

// Direction options for goals
const GOAL_DIRECTION_OPTIONS: {
  value: "statsigWinner" | "statsigLoser";
  label: string;
  color: "green" | "red";
  icon: React.ReactNode;
}[] = [
  {
    value: "statsigWinner",
    label: "Stat Sig Good",
    color: "green",
    icon: <PiArrowUp color="green" />,
  },
  {
    value: "statsigLoser",
    label: "Stat Sig Bad",
    color: "red",
    icon: <PiArrowDown color="red" />,
  },
];

// Direction options for guardrails
const GUARDRAIL_DIRECTION_OPTIONS: {
  value: "statsigLoser";
  label: string;
  color: "red";
  icon: React.ReactNode;
}[] = [
  {
    value: "statsigLoser",
    label: "Stat Sig Bad",
    color: "red",
    icon: <PiArrowDown color="red" />,
  },
];

// Action options
const ACTION_OPTIONS: {
  value: "ship" | "rollback" | "review";
  label: string;
  color: "green" | "red" | "amber";
  icon: React.ReactNode;
}[] = [
  {
    value: "ship",
    label: "Ship",
    color: "green",
    icon: <PiCheck color="green" />,
  },
  {
    value: "rollback",
    label: "Rollback",
    color: "red",
    icon: <PiMinusCircle color="red" />,
  },
  {
    value: "review",
    label: "Review",
    color: "amber",
    icon: <PiEye color="amber" />,
  },
];

const HEALTH_ACTION_OPTIONS: {
  value: DcHealthSignalAction;
  label: string;
  color: "amber" | "red" | "gray";
  icon: React.ReactNode;
}[] = [
  {
    value: "off",
    label: "Off",
    color: "gray",
    icon: <PiProhibit color="gray" />,
  },
  {
    value: "review",
    label: "Review",
    color: "amber",
    icon: <PiEye color="amber" />,
  },
  {
    value: "rollback",
    label: "Rollback",
    color: "red",
    icon: <PiMinusCircle color="red" />,
  },
];

const HEALTH_SIGNAL_LABELS: {
  key: keyof Pick<
    DcHealthSignals,
    "srmAction" | "multipleExposureAction" | "noTrafficAction"
  >;
  label: string;
}[] = [
  { key: "srmAction", label: "Sample Ratio Mismatch (SRM)" },
  { key: "multipleExposureAction", label: "Multiple Exposures" },
  { key: "noTrafficAction", label: "No Traffic" },
];

// ── Normalized shape consumed by the rendering logic ─────────────────────────

interface RuleView {
  key: string;
  conditions: (DecisionCriteriaCondition & { key: string })[];
  action: DecisionCriteriaAction;
}

interface CriteriaView {
  name: string;
  description: string;
  rules: RuleView[];
  defaultAction: DecisionCriteriaAction;
  healthSignals: DcHealthSignals;
}

function viewFromData(dc: DecisionCriteriaData): CriteriaView {
  return {
    name: dc.name,
    description: dc.description ?? "",
    rules: dc.rules.map((r, ri) => ({
      key: `r-${ri}`,
      conditions: r.conditions.map((c, ci) => ({ ...c, key: `c-${ri}-${ci}` })),
      action: r.action,
    })),
    defaultAction: dc.defaultAction,
    healthSignals: dc.healthSignals ?? { ...DEFAULT_DC_HEALTH_SIGNALS },
  };
}

function viewFromForm(
  form: ReturnType<typeof useDecisionCriteriaForm>["form"],
): CriteriaView {
  return {
    name: form.watch("name"),
    description: form.watch("description") ?? "",
    rules: form.watch("rules"),
    defaultAction: form.watch("defaultAction"),
    healthSignals:
      form.watch("healthSignals") ?? { ...DEFAULT_DC_HEALTH_SIGNALS },
  };
}

// ── Props ────────────────────────────────────────────────────────────────────

type DecisionCriteriaModalContentProps =
  | {
      decisionCriteriaFormProps: ReturnType<typeof useDecisionCriteriaForm>;
      editable?: boolean;
      decisionCriteria?: never;
    }
  | {
      decisionCriteria: DecisionCriteriaData;
      editable?: false;
      decisionCriteriaFormProps?: never;
    };

// ── Component ────────────────────────────────────────────────────────────────

const DecisionCriteriaModalContent: FC<DecisionCriteriaModalContentProps> = (
  props,
) => {
  const editable =
    props.editable ?? (props.decisionCriteriaFormProps ? true : false);

  const view: CriteriaView = props.decisionCriteriaFormProps
    ? viewFromForm(props.decisionCriteriaFormProps.form)
    : viewFromData(props.decisionCriteria);

  const formActions = props.decisionCriteriaFormProps;

  const handleAddRuleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    formActions?.addRule();
  };

  return (
    <Flex direction="column" gap="2">
      {editable && (
        <Flex direction="column" gap="1">
          <Text as="div" weight="semibold">
            Name
          </Text>
          <div className="form-group">
            <input
              type="text"
              className="form-control"
              placeholder="Decision Criteria Name"
              value={view.name}
              onChange={(e) =>
                formActions?.form.setValue("name", e.target.value)
              }
              required
              disabled={!editable}
            />
          </div>
          <Text as="div" weight="semibold">
            Description
          </Text>
          <div className="form-group">
            <textarea
              className="form-control"
              placeholder="(optional)"
              value={view.description}
              onChange={(e) =>
                formActions?.form.setValue("description", e.target.value)
              }
              rows={2}
              disabled={!editable}
            />
          </div>
        </Flex>
      )}

      <Heading as="h4" size="x-small" mt="2">
        Metric Rules
      </Heading>
      <Text as="div" size="small" color="text-mid">
        Rules are evaluated in order. If a rule matches, an action is
        recommended and no further rules are evaluated.
      </Text>

      {view.rules.map((rule, ruleIndex) => (
        <Flex
          key={rule.key}
          className="appbox mb-1 mt-1"
          direction="column"
          gap="2"
          p="2"
        >
          <Flex justify="between" align="center" mb="1">
            <Text as="div" weight="semibold">
              Rule {ruleIndex + 1}
            </Text>
            {ruleIndex > 0 && editable && (
              <IconButton
                variant="ghost"
                color="red"
                size="1"
                onClick={() => formActions?.removeRule(rule.key)}
              >
                <PiTrash />
              </IconButton>
            )}
          </Flex>

          {rule.conditions.map((condition, conditionIndex) => (
            <Flex key={condition.key} direction="column">
              <Flex align="center" gap="4" width="100%">
                <Box width="40px">
                  <Text as="div" color="text-mid">
                    {conditionIndex === 0 ? "If" : "and"}
                  </Text>
                </Box>

                <Box style={{ flex: 1 }}>
                  <Select
                    size={"2"}
                    value={condition.match}
                    setValue={(value) =>
                      formActions?.updateCondition(
                        rule.key,
                        condition.key,
                        "match",
                        value,
                      )
                    }
                    disabled={!editable}
                  >
                    {MATCH_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </Select>
                </Box>

                <Box style={{ flex: 1 }}>
                  <Select
                    size={"2"}
                    value={condition.metrics}
                    setValue={(value) => {
                      if (value === "guardrails") {
                        formActions?.updateCondition(
                          rule.key,
                          condition.key,
                          "direction",
                          "statsigLoser",
                        );
                      }
                      formActions?.updateCondition(
                        rule.key,
                        condition.key,
                        "metrics",
                        value,
                      );
                    }}
                    disabled={!editable}
                  >
                    {METRICS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </Select>
                </Box>

                <Box style={{ flex: 1 }}>
                  <Select
                    size={"2"}
                    value={condition.direction}
                    setValue={(value) =>
                      formActions?.updateCondition(
                        rule.key,
                        condition.key,
                        "direction",
                        value,
                      )
                    }
                    disabled={!editable || condition.metrics === "guardrails"}
                  >
                    {(condition.metrics === "goals"
                      ? GOAL_DIRECTION_OPTIONS
                      : GUARDRAIL_DIRECTION_OPTIONS
                    ).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <Flex align="center" gap="1">
                          {option.icon}
                          <Text key={option.value} color={option.color}>
                            {option.label}
                          </Text>
                        </Flex>
                      </SelectItem>
                    ))}
                  </Select>
                </Box>

                <Box width="40px" style={{ textAlign: "right" }}>
                  {conditionIndex > 0 && editable && (
                    <IconButton
                      variant="ghost"
                      color="red"
                      size="1"
                      onClick={() =>
                        formActions?.removeCondition(rule.key, condition.key)
                      }
                    >
                      <PiTrash />
                    </IconButton>
                  )}
                </Box>
              </Flex>

              {conditionIndex < rule.conditions.length - 1 && (
                <Separator size="4" mt="2" />
              )}
            </Flex>
          ))}

          <Flex justify="start" mt="1" mb="1">
            {editable && (
              <Link
                color="violet"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  formActions?.addCondition(rule.key);
                }}
              >
                <Flex align="center" gap="1">
                  <FaPlusCircle size={10} />
                  <span>Add condition</span>
                </Flex>
              </Link>
            )}
          </Flex>

          <Flex gap="4" align="center" width="100%">
            <Box width="70px">
              <Text as="div" weight="medium">
                Then
              </Text>
            </Box>
            <Flex width="100%" align="center" style={{ gridColumn: "span 11" }}>
              <Select
                size={"2"}
                value={rule.action}
                setValue={(value) =>
                  formActions?.updateRuleAction(
                    rule.key,
                    value as "ship" | "rollback" | "review",
                  )
                }
                disabled={!editable}
              >
                {ACTION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <Flex align="center" gap="1">
                      {option.icon}
                      <Text color={option.color}>{option.label}</Text>
                    </Flex>
                  </SelectItem>
                ))}
              </Select>
            </Flex>
          </Flex>
        </Flex>
      ))}
      <Flex justify="start" mt="1" mb="1">
        {editable && (
          <Link color="violet" onClick={handleAddRuleClick}>
            <Flex align="center" gap="1">
              <FaPlusCircle size={10} />
              <span>Add rule</span>
            </Flex>
          </Link>
        )}
      </Flex>

      <Flex direction="column" gap="1" className="appbox bg-light p-2 mb-0">
        <Flex gap="4" align="center" width="100%">
          <Box width="70px">
            <Text as="div" weight="medium">
              Otherwise
            </Text>
          </Box>
          <Select
            size={"2"}
            value={view.defaultAction}
            setValue={(value) =>
              formActions?.form.setValue(
                "defaultAction",
                value as "ship" | "rollback" | "review",
              )
            }
            disabled={!editable}
          >
            {ACTION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <Flex align="center" gap="1">
                  {option.icon}
                  <Text color={option.color}>{option.label}</Text>
                </Flex>
              </SelectItem>
            ))}
          </Select>
        </Flex>
      </Flex>

      <Separator size="4" my="3" />

      <Heading as="h4" size="x-small">
        Health Rules
      </Heading>

      <div
        className="appbox p-2 mb-0"
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto auto 1fr",
          gap: "8px 12px",
          alignItems: "center",
        }}
      >
        {HEALTH_SIGNAL_LABELS.map((signal) => (
          <React.Fragment key={signal.key}>
            <Text as="div" weight="medium" size="small">
              {signal.label}
            </Text>

            {signal.key === "noTrafficAction" ? (
              <Flex align="center" gap="1">
                <Text as="span" size="small" color="text-mid">
                  for
                </Text>
                <div className="input-group input-group-sm" style={{ width: 90 }}>
                  <input
                    type="number"
                    value={view.healthSignals.noTrafficGracePeriodHours}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val = parseFloat(raw);
                      if (!isNaN(val) && val > 0) {
                        formActions?.form.setValue(
                          "healthSignals.noTrafficGracePeriodHours",
                          Math.round(val * 100) / 100,
                        );
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                    min={1}
                    step={0.5}
                    disabled={!editable}
                    className="form-control form-control-sm"
                    style={{ textAlign: "center" }}
                  />
                  <div className="input-group-append">
                    <span className="input-group-text px-2">h</span>
                  </div>
                </div>
              </Flex>
            ) : (
              <div />
            )}

            <Select
              size="2"
              value={view.healthSignals[signal.key]}
              setValue={(value) =>
                formActions?.form.setValue(
                  `healthSignals.${signal.key}`,
                  value as DcHealthSignalAction,
                )
              }
              disabled={!editable}
            >
              {HEALTH_ACTION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <Flex align="center" gap="1">
                    {option.icon}
                    <Text color={option.color}>{option.label}</Text>
                  </Flex>
                </SelectItem>
              ))}
            </Select>
            <div />
          </React.Fragment>
        ))}
      </div>
    </Flex>
  );
};

export default DecisionCriteriaModalContent;
