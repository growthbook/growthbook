import { FC, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Flex, Grid, Text } from "@radix-ui/themes";
import { FaPlusCircle, FaTrash } from "react-icons/fa";
import {
  DecisionCriteriaInterface,
  DecisionCriteriaCondition,
  DecisionCriteriaRule,
  DecisionCriteriaData,
} from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";
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
const GOAL_DIRECTION_OPTIONS = [
  { value: "statsigWinner", label: "Stat Sig Good" },
  { value: "statsigLoser", label: "Stat Sig Bad" },
  { value: "trendingLoser", label: "Trending Bad" },
];

// Direction options for guardrails
const GUARDRAIL_DIRECTION_OPTIONS = [
  { value: "statsigLoser", label: "Stat Sig Bad" },
  { value: "trendingLoser", label: "Trending Bad" },
];

// Action options
const ACTION_OPTIONS = [
  { value: "ship", label: "Ship" },
  { value: "rollback", label: "Rollback" },
  { value: "review", label: "Review" },
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

  // Remove a rule by ID
  const removeRule = (id: string) => {
    const currentRules = form.getValues("rules");
    if (currentRules.length <= 1) return; // Ensure at least one rule remains
    form.setValue(
      "rules",
      currentRules.filter((rule) => rule.id !== id)
    );
  };

  // Add a condition to a rule
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

  // Remove a condition from a rule
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

  // Update a condition property
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

  // Update a rule's action
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

  // Handle save
  const handleSave = async () => {
    const formData = form.getValues();

    // Strip the IDs from rules and conditions before saving
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const rulesToSave = formData.rules.map(({ id, conditions, action }) => ({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      conditions: conditions.map(({ id, ...conditionRest }) => conditionRest),
      action,
    }));

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
            Decription
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
          Rules are evaluated in order. If a rule matches, the action is
          recommended and no further rules are evaluated.
        </Text>

        {form.watch("rules").map((rule, ruleIndex) => (
          <Flex
            key={rule.id}
            direction="column"
            gap="1"
            style={{
              padding: "10px",
              border: "1px solid var(--gray-5)",
              borderRadius: "6px",
            }}
          >
            <Flex justify="between" align="center" mb="1">
              <Text weight="bold" size="2">
                Rule {ruleIndex + 1}
              </Text>
              {form.watch("rules").length > 1 && !disabled && (
                <Text
                  as="span"
                  color="crimson"
                  size="1"
                  style={{ cursor: "pointer" }}
                  onClick={() => removeRule(rule.id)}
                >
                  <FaTrash size={10} className="mr-1" />
                  remove
                </Text>
              )}
            </Flex>

            {rule.conditions.map((condition, conditionIndex) => (
              <Flex key={condition.id} direction="column" gap="1">
                <Grid columns="12" gap="1" align="center" width="100%">
                  <Flex
                    width="100%"
                    justify="start"
                    style={{ gridColumn: "span 1" }}
                  >
                    <Text
                      size="2"
                      color={conditionIndex > 0 ? "gray" : undefined}
                    >
                      {conditionIndex === 0 ? "If" : "AND"}
                    </Text>
                  </Flex>

                  <Flex width="100%" style={{ gridColumn: "span 3" }}>
                    <Select
                      label=""
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
                  </Flex>

                  <Flex width="100%" style={{ gridColumn: "span 3" }}>
                    <Select
                      label=""
                      value={condition.metrics}
                      setValue={(value) =>
                        updateCondition(rule.id, condition.id, "metrics", value)
                      }
                      disabled={disabled}
                    >
                      {METRICS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </Select>
                  </Flex>

                  <Flex width="100%" style={{ gridColumn: "span 3" }}>
                    <Select
                      label=""
                      value={condition.direction}
                      setValue={(value) =>
                        updateCondition(
                          rule.id,
                          condition.id,
                          "direction",
                          value
                        )
                      }
                      disabled={disabled}
                    >
                      {(condition.metrics === "goals"
                        ? GOAL_DIRECTION_OPTIONS
                        : GUARDRAIL_DIRECTION_OPTIONS
                      ).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </Select>
                  </Flex>

                  <Flex justify="end" style={{ gridColumn: "span 2" }}>
                    {rule.conditions.length > 1 && !disabled && (
                      <Text
                        as="span"
                        color="crimson"
                        size="1"
                        style={{ cursor: "pointer" }}
                        onClick={() => removeCondition(rule.id, condition.id)}
                      >
                        <FaTrash size={10} style={{ marginRight: "4px" }} />
                        remove
                      </Text>
                    )}
                  </Flex>
                </Grid>
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

            <Grid columns="12" gap="1" align="center" width="100%">
              <Flex
                width="100%"
                justify="start"
                style={{ gridColumn: "span 1" }}
              >
                <Text weight="medium" size="2">
                  Then
                </Text>
              </Flex>
              <Flex width="100%" style={{ gridColumn: "span 11" }}>
                <Select
                  label=""
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
                      {option.label}
                    </SelectItem>
                  ))}
                </Select>
              </Flex>
            </Grid>
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
                <FaPlusCircle size={12} />
                <span>Add rule</span>
              </Flex>
            </Text>
          )}
        </Flex>

        {/* Add the "Else Then Review" rule */}
        <Flex
          direction="column"
          gap="1"
          style={{
            padding: "10px",
            border: "1px solid var(--gray-5)",
            borderRadius: "6px",
            backgroundColor: "var(--gray-2)",
          }}
        >
          <Grid columns="12" gap="1" align="center" width="100%">
            <Flex width="100%" justify="start" style={{ gridColumn: "span 2" }}>
              <Text weight="medium" size="2">
                Otherwise
              </Text>
            </Flex>
            <Flex width="100%" style={{ gridColumn: "span 10" }}>
              <Select
                label=""
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
                    {option.label}
                  </SelectItem>
                ))}
              </Select>
            </Flex>
          </Grid>
        </Flex>
      </Flex>
    </Modal>
  );
};

export default DecisionCriteriaModal;
