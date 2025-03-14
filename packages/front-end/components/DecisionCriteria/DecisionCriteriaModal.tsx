import { FC, useState, useEffect, ReactNode, useCallback } from "react";
import { useForm } from "react-hook-form";
import { Flex, Grid, Text, Box } from "@radix-ui/themes";
import { FaPlusCircle, FaTrash } from "react-icons/fa";
import {
  DecisionCriteriaInterface,
  DecisionCriteriaCondition,
  DecisionCriteriaRule,
} from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";
import { Select, SelectItem } from "@/components/Radix/Select";
import RadioCards from "@/components/Radix/RadioCards";
import PagedModal from "@/components/Modal/PagedModal";
import { useAuth } from "@/services/auth";
import Button from "@/components/Radix/Button";

// UI version with id for tracking
interface DecisionCriteriaConditionUI extends DecisionCriteriaCondition {
  id: string; // For UI tracking
}

// UI version with id for tracking
interface DecisionCriteriaRuleUI extends DecisionCriteriaRule {
  id: string; // For UI tracking
  conditions: DecisionCriteriaConditionUI[];
}

type DecisionCriteriaUI = Pick<
  DecisionCriteriaInterface,
  "id" | "name" | "description" | "rules" | "defaultAction"
>;

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

const DecisionCriteriaModal: FC<DecisionCriteriaModalProps> = ({
  open,
  decisionCriteria,
  onClose,
  onSave,
  initialPlan,
  trackingEventModalSource,
}) => {
  const { apiCall } = useAuth();
  const [step, setStep] = useState(0);
  const [selectedCriteriaId, setSelectedCriteriaId] = useState<string | null>(
    initialPlan?.id || null
  );

  // Initialize form with empty values first
  const form = useForm<DecisionCriteriaFormData>({
    defaultValues: {
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
      name: initialPlan?.name || "",
      description: initialPlan?.description || "",
      defaultAction: initialPlan?.defaultAction || "review",
      rules: initialPlan?.rules?.length
        ? initialPlan.rules.map((rule) => ({
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
  }, [initialPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDecisionCriteriasWithDefault = useCallback(
    (criterias: DecisionCriteriaUI[]) => {
      setDecisionCriterias([...criterias, ...DEFAULT_DECISION_CRITERIA]);
    },
    []
  );

  // Fetch decision criterias when the modal opens
  useEffect(() => {
    if (open) {
      const fetchDecisionCriterias = async () => {
        try {
          setLoading(true);
          // Use the decision-criteria endpoint
          const response = await apiCall<{
            status: number;
            decisionCriteria: DecisionCriteriaInterface[];
          }>("/decision-criteria");
          if (response?.decisionCriteria) {
            setDecisionCriteriasWithDefault(response.decisionCriteria);
          }
        } catch (error) {
          console.error("Error fetching decision criteria:", error);
          // Fallback to the old endpoint if the new one fails
          try {
            const response = await apiCall<{
              status: number;
              decisionCriteria: DecisionCriteriaInterface[];
            }>("/decision-criteria");
            if (response?.decisionCriteria) {
              setDecisionCriteriasWithDefault(response.decisionCriteria);
            }
          } catch (fallbackError) {
            console.error(
              "Error fetching from fallback endpoint:",
              fallbackError
            );
          }
        } finally {
          setLoading(false);
        }
      };

      fetchDecisionCriterias();
    }
  }, [apiCall, open, setDecisionCriteriasWithDefault]);

  // Load selected decision criteria data when a criteria is selected
  useEffect(() => {
    if (selectedCriteriaId) {
      const selectedCriteria = decisionCriterias.find(
        (criteria) => criteria.id === selectedCriteriaId
      );
      if (selectedCriteria) {
        form.reset({
          name: selectedCriteria.name,
          description: selectedCriteria.description || "",
          defaultAction: selectedCriteria.defaultAction || "review",
          rules: selectedCriteria.rules.map((rule) => ({
            ...rule,
            id: generateId(),
            conditions: rule.conditions.map((condition) => ({
              ...condition,
              id: generateId(),
            })),
          })),
        });
      }
    } else {
      // Reset to default values when creating a new decision criteria
      form.reset({
        name: "",
        description: "",
        defaultAction: "review",
        rules: [
          {
            id: generateId(),
            conditions: [createDefaultCondition()],
            action: "review",
          },
        ],
      });
    }
  }, [selectedCriteriaId, decisionCriterias, form]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const decisionCriteria = {
      name: formData.name,
      description: formData.description,
      rules: rulesToSave,
      defaultAction: formData.defaultAction,
    };

    // If we have an ID, we're updating an existing decision criteria
    if (selectedCriteriaId) {
      try {
        // Try the new endpoint first
        await apiCall(`/decision-criteria/${selectedCriteriaId}`, {
          method: "PUT",
          body: JSON.stringify(decisionCriteria),
        });
      } catch (error) {
        console.error("Error updating decision criteria:", error);
        // Fallback to the old endpoint
        try {
          await apiCall(`/decision-criteria/${selectedCriteriaId}`, {
            method: "PUT",
            body: JSON.stringify(decisionCriteria),
          });
        } catch (fallbackError) {
          console.error(
            "Error updating with fallback endpoint:",
            fallbackError
          );
          throw fallbackError;
        }
      }
    } else {
      // Otherwise, we're creating a new one
      try {
        // Try the new endpoint first
        await apiCall("/decision-criteria", {
          method: "POST",
          body: JSON.stringify(decisionCriteria),
        });
      } catch (error) {
        console.error("Error creating decision criteria:", error);
        // Fallback to the old endpoint
        try {
          await apiCall("/decision-criteria", {
            method: "POST",
            body: JSON.stringify(decisionCriteria),
          });
        } catch (fallbackError) {
          console.error(
            "Error creating with fallback endpoint:",
            fallbackError
          );
          throw fallbackError;
        }
      }
    }

    onSave(decisionCriteria);
  };
  // Only render the modal if it's open
  if (!open) return null;

  return (
      <Modal

      header="Modify Decision Criteria"
      subHeader="Define rules for automatic decision making based on experiment results"
      close={onClose}
      submit={handleSave}
      cta="Save Decision Criteria"
      size="lg"
      step={step}
      setStep={setStep}
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
              />
            </div>
            <Text weight="bold" size="2">
              Decription
            </Text>
            <div className="form-group">
              <textarea
                className="form-control"
                placeholder="Description (optional)"
                value={form.watch("description")}
                onChange={(e) => form.setValue("description", e.target.value)}
                rows={2}
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
                {form.watch("rules").length > 1 && (
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
                          updateCondition(
                            rule.id,
                            condition.id,
                            "metrics",
                            value
                          )
                        }
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
                      {rule.conditions.length > 1 && (
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
              <Flex
                width="100%"
                justify="start"
                style={{ gridColumn: "span 2" }}
              >
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
      </Step>
    </PagedModal>
  );
};

export default DecisionCriteriaModal;
