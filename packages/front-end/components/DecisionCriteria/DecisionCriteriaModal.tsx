import { FC, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex, IconButton, Separator, Text } from "@radix-ui/themes";
import { FaPlusCircle } from "react-icons/fa";
import {
  DecisionCriteriaInterface,
  DecisionCriteriaCondition,
  DecisionCriteriaRule,
  DecisionCriteriaData,
} from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";
import {
  PiArrowDown,
  PiArrowUp,
  PiCheck,
  PiEye,
  PiMinusCircle,
  PiTrash,
} from "react-icons/pi";
import { Select, SelectItem } from "@/components/Radix/Select";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";

// UI version with id for tracking
interface DecisionCriteriaConditionUI extends DecisionCriteriaCondition {
  id: string; // For UI tracking
}

// UI version with id for tracking
interface DecisionCriteriaRuleUI extends DecisionCriteriaRule {
  id: string; // For UI tracking
  conditions: DecisionCriteriaConditionUI[];
}

type DecisionCriteriaBase = Pick<
  DecisionCriteriaInterface,
  "name" | "description" | "rules" | "defaultAction"
>;

// Define the form data type
interface DecisionCriteriaFormData extends DecisionCriteriaBase {
  rules: DecisionCriteriaRuleUI[];
}

// Match options
const MATCH_OPTIONS = [
  { value: "all", label: "All" },
  { value: "any", label: "Any" },
  { value: "none", label: "None" },
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

interface DecisionCriteriaModalProps {
  open: boolean;
  decisionCriteria?: DecisionCriteriaData;
  onClose: () => void;
  mutate: () => void;
  trackingEventModalSource?: string;
  disabled?: boolean;
}

const DecisionCriteriaModal: FC<DecisionCriteriaModalProps> = ({
  open,
  decisionCriteria,
  onClose,
  mutate,
  trackingEventModalSource,
  disabled = false,
}) => {
  const { apiCall } = useAuth();

  // Initialize form with empty values first
  const form = useForm<DecisionCriteriaFormData>({
    defaultValues: decisionCriteria ?? {
      name: "",
      description: "",
      defaultAction: "review",
      rules: [],
    },
  });

  // Generate a unique ID for each rule and condition
  const generateId = () =>
    `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Create a default condition
  const createDefaultCondition = (): DecisionCriteriaConditionUI => ({
    id: generateId(),
    match: "all",
    metrics: "goals",
    direction: "statsigWinner",
  });

  // Set initial form values after functions are defined
  useEffect(() => {
    form.reset({
      name: decisionCriteria?.name || "",
      description: decisionCriteria?.description || "",
      defaultAction: decisionCriteria?.defaultAction || "review",
      rules: decisionCriteria?.rules?.length
        ? decisionCriteria.rules.map((rule) => ({
            ...rule,
            id: generateId(),
            conditions: rule.conditions.map((condition) => ({
              ...condition,
              id: generateId(),
            })),
          }))
        : [
            {
              id: generateId(),
              conditions: [createDefaultCondition()],
              action: "review",
            },
          ],
    });
  }, [decisionCriteria]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add a new rule
  const addRule = () => {
    const currentRules = form.getValues("rules");
    form.setValue("rules", [
      ...currentRules,
      {
        id: generateId(),
        conditions: [createDefaultCondition()],
        action: "review",
      },
    ]);
  };

  // Handle add rule click with propagation prevention
  const handleAddRuleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addRule();
  };

  const removeRule = (id: string) => {
    const currentRules = form.getValues("rules");
    if (currentRules.length <= 1) return; // Ensure at least one rule remains
    form.setValue(
      "rules",
      currentRules.filter((rule) => rule.id !== id)
    );
  };

  const addCondition = (ruleId: string) => {
    const currentRules = form.getValues("rules");
    form.setValue(
      "rules",
      currentRules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              conditions: [...rule.conditions, createDefaultCondition()],
            }
          : rule
      )
    );
  };

  const removeCondition = (ruleId: string, conditionId: string) => {
    const currentRules = form.getValues("rules");
    form.setValue(
      "rules",
      currentRules.map((rule) => {
        if (rule.id !== ruleId) return rule;

        // Ensure at least one condition remains
        if (rule.conditions.length <= 1) return rule;

        return {
          ...rule,
          conditions: rule.conditions.filter(
            (condition) => condition.id !== conditionId
          ),
        };
      })
    );
  };

  const updateCondition = (
    ruleId: string,
    conditionId: string,
    field: keyof Omit<DecisionCriteriaConditionUI, "id">,
    value: string
  ) => {
    const currentRules = form.getValues("rules");
    form.setValue(
      "rules",
      currentRules.map((rule) => {
        if (rule.id !== ruleId) return rule;

        return {
          ...rule,
          conditions: rule.conditions.map((condition) =>
            condition.id === conditionId
              ? { ...condition, [field]: value }
              : condition
          ),
        };
      })
    );
  };

  const updateRuleAction = (
    ruleId: string,
    value: "ship" | "rollback" | "review"
  ) => {
    const currentRules = form.getValues("rules");
    form.setValue(
      "rules",
      currentRules.map((rule) =>
        rule.id === ruleId ? { ...rule, action: value } : rule
      )
    );
  };

  const handleSave = async () => {
    const formData = form.getValues();

    // Strip the IDs from rules and conditions before saving
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const rulesToSave = formData.rules.map(({ id, conditions, action }) => ({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      conditions: conditions.map(({ id, ...conditionRest }) => conditionRest),
      action,
    }));

    // validate no guardrail has statsig winner
    const guardrailWithStatsigWinner = rulesToSave.some((rule) =>
      rule.conditions.some(
        (condition) =>
          condition.metrics === "guardrails" &&
          condition.direction === "statsigWinner"
      )
    );
    if (guardrailWithStatsigWinner) {
      throw new Error(
        "Guardrails cannot be checked for Stat Sig Good results."
      );
    }

    // Use the existing API endpoint structure but with our new naming
    const updatedCriteria = {
      name: formData.name,
      description: formData.description,
      rules: rulesToSave,
      defaultAction: formData.defaultAction,
    };

    // If we have an ID, we're updating an existing decision criteria
    if (decisionCriteria?.id) {
      try {
        await apiCall(`/decision-criteria/${decisionCriteria.id}`, {
          method: "PUT",
          body: JSON.stringify(updatedCriteria),
        });
      } catch (error) {
        console.error("Error updating decision criteria:", error);
      }
    } else {
      // Otherwise, we're creating a new one
      try {
        await apiCall("/decision-criteria", {
          method: "POST",
          body: JSON.stringify(updatedCriteria),
        });
      } catch (error) {
        console.error("Error creating decision criteria:", error);
      }
    }
    mutate();
  };
  // Only render the modal if it's open
  if (!open) return null;

  return (
    <Modal
      open={open}
      header="Modify Decision Criteria"
      subHeader="Define rules for automatic decision making based on experiment results"
      close={onClose}
      submit={!disabled ? handleSave : undefined}
      cta={!disabled ? "Save Decision Criteria" : undefined}
      size="lg"
      trackingEventModalType="decision_criteria_create"
      trackingEventModalSource={trackingEventModalSource}
    >
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
              disabled={disabled}
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
              disabled={disabled}
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
            key={rule.id}
            className="appbox mb-1 mt-1"
            direction="column"
            gap="2"
            p="2"
          >
            <Flex justify="between" align="center" mb="1">
              <Text weight="bold" size="2">
                Rule {ruleIndex + 1}
              </Text>
              {ruleIndex > 0 && !disabled && (
                <IconButton
                  variant="ghost"
                  color="red"
                  size="1"
                  onClick={() => removeRule(rule.id)}
                >
                  <PiTrash />
                </IconButton>
              )}
            </Flex>

            {rule.conditions.map((condition, conditionIndex) => (
              <Flex key={condition.id} direction="column">
                <Flex align="center" gap="4" width="100%">
                  <Box width="40px">
                    <Text size="2" color={"gray"}>
                      {conditionIndex === 0 ? "If" : "and"}
                    </Text>
                  </Box>

                  <Box style={{ flex: 1 }}>
                    <Select
                      value={condition.match}
                      setValue={(value) =>
                        updateCondition(rule.id, condition.id, "match", value)
                      }
                      disabled={disabled}
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
                      value={condition.metrics}
                      setValue={(value) => {
                        if (value === "guardrails") {
                          updateCondition(
                            rule.id,
                            condition.id,
                            "direction",
                            "statsigLoser"
                          );
                        }
                        updateCondition(
                          rule.id,
                          condition.id,
                          "metrics",
                          value
                        );
                      }}
                      disabled={disabled}
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
                      value={condition.direction}
                      setValue={(value) =>
                        updateCondition(
                          rule.id,
                          condition.id,
                          "direction",
                          value
                        )
                      }
                      disabled={disabled || condition.metrics === "guardrails"}
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
                    {conditionIndex > 0 && !disabled && (
                      <IconButton
                        variant="ghost"
                        color="red"
                        size="1"
                        onClick={() => removeCondition(rule.id, condition.id)}
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
              {!disabled && (
                <Text
                  as="span"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    addCondition(rule.id);
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
              <Flex
                width="100%"
                align="center"
                style={{ gridColumn: "span 11" }}
              >
                <Select
                  value={rule.action}
                  setValue={(value) =>
                    updateRuleAction(
                      rule.id,
                      value as "ship" | "rollback" | "review"
                    )
                  }
                  disabled={disabled}
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
          {!disabled && (
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
              value={form.watch("defaultAction")}
              setValue={(value) =>
                form.setValue(
                  "defaultAction",
                  value as "ship" | "rollback" | "review"
                )
              }
              disabled={disabled}
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
    </Modal>
  );
};

export default DecisionCriteriaModal;
