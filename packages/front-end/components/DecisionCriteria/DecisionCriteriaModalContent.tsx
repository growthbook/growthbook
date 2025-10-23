import { FC } from "react";
import { Box, Flex, IconButton, Separator, Text } from "@radix-ui/themes";
import { FaPlusCircle } from "react-icons/fa";
import {
  PiArrowDown,
  PiArrowUp,
  PiCheck,
  PiEye,
  PiMinusCircle,
  PiTrash,
} from "react-icons/pi";
import { Select, SelectItem } from "@/ui/Select";
import { useDecisionCriteriaForm } from "@/hooks/useDecisionCriteriaForm";

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

interface DecisionCriteriaModalContentProps {
  decisionCriteriaFormProps: ReturnType<typeof useDecisionCriteriaForm>;
  editable?: boolean;
}

const DecisionCriteriaModalContent: FC<DecisionCriteriaModalContentProps> = ({
  decisionCriteriaFormProps,
  editable = true,
}) => {
  const {
    addRule,
    form,
    removeRule,
    addCondition,
    removeCondition,
    updateCondition,
    updateRuleAction,
  } = decisionCriteriaFormProps;

  // Handle add rule click with propagation prevention
  const handleAddRuleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addRule();
  };

  return (
    <Flex direction="column" gap="2">
      <Flex direction="column" gap="1">
        <Text weight="bold" size="2">
          Name
        </Text>
        <div className="form-group">
          <input
            type="text"
            className="form-control"
            placeholder="Decision Criteria Name"
            value={form.watch("name")}
            onChange={(e) => form.setValue("name", e.target.value)}
            required
            disabled={!editable}
          />
        </div>
        <Text weight="bold" size="2">
          Description
        </Text>
        <div className="form-group">
          <textarea
            className="form-control"
            placeholder="(optional)"
            value={form.watch("description")}
            onChange={(e) => form.setValue("description", e.target.value)}
            rows={2}
            disabled={!editable}
          />
        </div>
      </Flex>

      <Text weight="bold" size="2">
        Rules
      </Text>
      <Text size="2">
        Rules are evaluated in order. If a rule matches, an action is
        recommended and no further rules are evaluated.
      </Text>

      {form.watch("rules").map((rule, ruleIndex) => (
        <Flex
          key={rule.key}
          className="appbox mb-1 mt-1"
          direction="column"
          gap="2"
          p="2"
        >
          <Flex justify="between" align="center" mb="1">
            <Text weight="bold" size="2">
              Rule {ruleIndex + 1}
            </Text>
            {ruleIndex > 0 && editable && (
              <IconButton
                variant="ghost"
                color="red"
                size="1"
                onClick={() => removeRule(rule.key)}
              >
                <PiTrash />
              </IconButton>
            )}
          </Flex>

          {rule.conditions.map((condition, conditionIndex) => (
            <Flex key={condition.key} direction="column">
              <Flex align="center" gap="4" width="100%">
                <Box width="40px">
                  <Text size="2" color={"gray"}>
                    {conditionIndex === 0 ? "If" : "and"}
                  </Text>
                </Box>

                <Box style={{ flex: 1 }}>
                  <Select
                    size={"2"}
                    value={condition.match}
                    setValue={(value) =>
                      updateCondition(rule.key, condition.key, "match", value)
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
                        updateCondition(
                          rule.key,
                          condition.key,
                          "direction",
                          "statsigLoser",
                        );
                      }
                      updateCondition(
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
                      updateCondition(
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
                      onClick={() => removeCondition(rule.key, condition.key)}
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
              <Text
                as="span"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  addCondition(rule.key);
                }}
                color="purple"
                style={{
                  cursor: "pointer",
                }}
              >
                <Flex align="center" gap="1">
                  <FaPlusCircle size={10} />
                  <span>Add condition</span>
                </Flex>
              </Text>
            )}
          </Flex>

          <Flex gap="4" align="center" width="100%">
            <Box width="70px">
              <Text weight="medium" size="2">
                Then
              </Text>
            </Box>
            <Flex width="100%" align="center" style={{ gridColumn: "span 11" }}>
              <Select
                size={"2"}
                value={rule.action}
                setValue={(value) =>
                  updateRuleAction(
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
          <Text
            as="span"
            onClick={handleAddRuleClick}
            color="purple"
            style={{
              cursor: "pointer",
            }}
          >
            <Flex align="center" gap="1">
              <FaPlusCircle size={10} />
              <span>Add rule</span>
            </Flex>
          </Text>
        )}
      </Flex>

      <Flex direction="column" gap="1" className="appbox bg-light p-2 mb-0">
        <Flex gap="4" align="center" width="100%">
          <Box width="70px">
            <Text weight="medium" size="2">
              Otherwise
            </Text>
          </Box>
          <Select
            size={"2"}
            value={form.watch("defaultAction")}
            setValue={(value) =>
              form.setValue(
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
    </Flex>
  );
};

export default DecisionCriteriaModalContent;
