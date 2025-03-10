import { FC, useState, useEffect, ReactNode, useCallback } from "react";
import { useForm } from "react-hook-form";
import {
  Flex,
  Grid,
  Text,
  Box,
} from "@radix-ui/themes";
import { FaPlusCircle, FaTrash } from "react-icons/fa";
import { Select, SelectItem } from "@/components/Radix/Select";
import RadioCards from "@/components/Radix/RadioCards";
import PagedModal from "@/components/Modal/PagedModal";
import { useAuth } from "@/services/auth";
import { AnalysisPlanInterface } from "back-end/types/experiment";
import { 
  analysisPlanCondition as backendAnalysisPlanCondition, 
  analysisPlanRule as backendAnalysisPlanRule 
} from "back-end/src/enterprise/routers/analysis-plan/analysis-plan.validators";
import { z } from "zod";
import Button from "@/components/Radix/Button";

// Define UI-specific versions of the types that include an id field for tracking
type AnalysisPlanConditionBase = z.infer<typeof backendAnalysisPlanCondition>;
type AnalysisPlanRuleBase = z.infer<typeof backendAnalysisPlanRule>;

// UI version with id for tracking
interface AnalysisPlanConditionUI extends AnalysisPlanConditionBase {
  id: string; // For UI tracking
}

// UI version with id for tracking
interface AnalysisPlanRuleUI extends AnalysisPlanRuleBase {
  id: string; // For UI tracking
  conditions: AnalysisPlanConditionUI[];
}

// Define the props for the AnalysisPlanModal component
interface AnalysisPlanModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (
    analysisPlan: {
      name: string;
      description: string;
      rules: AnalysisPlanRuleBase[];
      defaultAction: "ship" | "rollback" | "review";
    }
  ) => void;
  initialPlan?: AnalysisPlanInterface;
  trackingEventModalSource?: string;
}

type AnalysisPlanUI = Pick<AnalysisPlanInterface, "id" | "name" | "description" | "rules" | "defaultAction">;

// Match options
const MATCH_OPTIONS = [
  { value: "all", label: "All" },
  //{ value: "most", label: "Most" },
  { value: "any", label: "Any" },
  { value: "none", label: "No" },
];

// Metrics options
const METRICS_OPTIONS = [
  { value: "goals", label: "Goals" },
  { value: "guardrails", label: "Guardrails" },
];

// Direction options
const GOAL_DIRECTION_OPTIONS = [
  { value: "statsigWinner", label: "Stat Sig Good" },
  { value: "statsigLoser", label: "Stat Sig Bad" },
  { value: "trendingLoser", label: "Trending Bad" },
];

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

// Define the Step component for PagedModal
interface StepProps {
  display: string | ReactNode;
  enabled?: boolean;
  validate?: () => Promise<void>;
  customNext?: () => void;
  children: ReactNode;
}

const Step: FC<StepProps> = ({ children }) => {
  return <>{children}</>;
};

const DEFAULT_ANALYSIS_PLANS: AnalysisPlanUI[] = [
  {
    id: "gb_strict-rollout",
    name: "Strict Rollout",
    description: "The default plan to only ship or rollback with clear signals. Conservative, but guards against false positives and automated decision making when results have any ambiguity. Guardrails, however, should never fail.",
    rules: [
      {
        conditions: [
          {
            match: "all",
            metrics: "goals",
            direction: "statsigWinner",
          },
          {
            match: "none",
            metrics: "guardrails",
            direction: "statsigLoser",
          },
        ],
        action: "ship",
      },
      {
        conditions: [
          {
            match: "any",
            metrics: "guardrails",
            direction: "statsigLoser",
          },
        ],
        action: "rollback",
      },
      {
        conditions: [
          {
            match: "all",
            metrics: "goals",
            direction: "statsigLoser",
          },
        ],
        action: "rollback",
      },
    ],
    defaultAction: "review",
  },
  {
    id: "gb_do-no-harm",
    name: "Do No Harm",
    description: "Ship so long as no guardrails and no goal metrics are failing. This is the most permissive plan, and can be useful if the costs of shipping are very low.",
    rules: [
      {
        conditions: [
          {
            match: "none",
            metrics: "goals",
            direction: "statsigLoser",
          },
          {
            match: "none",
            metrics: "guardrails",
            direction: "statsigLoser",
          },
        ],
        action: "ship",
      },
    ],
    defaultAction: "rollback"
  },
];

// Define the form data type
interface AnalysisPlanFormData {
  name: string;
  description: string;
  defaultAction: "ship" | "rollback" | "review";
  rules: AnalysisPlanRuleUI[];
}

export const AnalysisPlanModal: FC<AnalysisPlanModalProps> = ({
  open,
  onClose,
  onSave,
  initialPlan,
  trackingEventModalSource,
}) => {
  const { apiCall } = useAuth();
  const [step, setStep] = useState(0);
  const [analysisPlans, setAnalysisPlans] = useState<AnalysisPlanUI[]>(DEFAULT_ANALYSIS_PLANS);
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(initialPlan?.id || null);
  
  // Initialize form with empty values first
  const form = useForm<AnalysisPlanFormData>({
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
  const createDefaultCondition = (): AnalysisPlanConditionUI => ({
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

  const setAnalysisPlansWithDefault = useCallback((analysisPlans: AnalysisPlanUI[]) => {
    setAnalysisPlans([
      ...analysisPlans,
      ...DEFAULT_ANALYSIS_PLANS,
    ]);
  }, [DEFAULT_ANALYSIS_PLANS, setAnalysisPlans]);

  // Fetch analysis plans when the modal opens
  useEffect(() => {
    if (open) {
      const fetchAnalysisPlans = async () => {
        try {
          setLoading(true);
          const response = await apiCall<{ status: number; analysisPlans: AnalysisPlanInterface[] }>("/analysis-plans");
          if (response?.analysisPlans) {
            setAnalysisPlansWithDefault(response.analysisPlans);
          }
        } catch (error) {
          console.error("Error fetching analysis plans:", error);
        } finally {
          setLoading(false);
        }
      };

      fetchAnalysisPlans();
    }
  }, [apiCall, open, setAnalysisPlansWithDefault]);

  // Load selected plan data when a plan is selected
  useEffect(() => {
    if (selectedPlanId) {
      const selectedPlan = analysisPlans.find(plan => plan.id === selectedPlanId);
      if (selectedPlan) {
        form.reset({
          name: selectedPlan.name,
          description: selectedPlan.description || "",
          defaultAction: selectedPlan.defaultAction || "review",
          rules: selectedPlan.rules.map((rule) => ({
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
      // Reset to default values when creating a new plan
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
  }, [selectedPlanId, analysisPlans, form]);

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
    field: keyof Omit<AnalysisPlanConditionUI, "id">,
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
  const updateRuleAction = (ruleId: string, value: "ship" | "rollback" | "review") => {
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
    const rulesToSave = formData.rules.map(({ id, conditions, action }) => ({
      conditions: conditions.map(({ id, ...conditionRest }) => conditionRest),
      action,
    }));

    onSave({
      name: formData.name,
      description: formData.description,
      rules: rulesToSave,
      defaultAction: formData.defaultAction,
    });
  };

  // Validate the first step
  const validateFirstStep = async () => {
    if (selectedPlanId === null && step === 0) {
      // If creating a new plan, move to the next step
      return;
    }
  };

  // Validate the second step
  const validateSecondStep = async () => {
    if (!form.getValues("name").trim()) {
      throw new Error("Name is required");
    }
  };

  // Only render the modal if it's open
  if (!open) return null;

  return (
    <PagedModal
      header="Modify Analysis Plans"
      subHeader="Define rules for automatic decision making based on experiment results"
      close={onClose}
      submit={handleSave}
      cta="Save Analysis Plan"
      size="lg"
      step={step}
      setStep={setStep}
      trackingEventModalType="analysis_plan_create"
      trackingEventModalSource={trackingEventModalSource}
    >
      <Step display="Select or Create Analysis Plan" enabled={true} validate={validateFirstStep}>
        <Flex direction="column" gap="3">
          {loading ? (
            <Text>Loading analysis plans...</Text>
          ) : (
            <>
              <Flex direction="column" gap="2">
                {analysisPlans.length > 0 && (
                  <>
                    <RadioCards
                      width="100%"
                      columns="1"
                      value={selectedPlanId || ""}
                      setValue={(value) => setSelectedPlanId(value)}
                      options={analysisPlans.map((plan) => ({
                        value: plan.id,
                        label: plan.name,
                        description: (
                          <Flex direction="column" gap="1">
                            {plan.description && (
                              <Text size="1" color="gray">
                                {plan.description}
                              </Text>
                            )}
                            <Text size="1" color="gray">
                              {plan.rules.length} rule{plan.rules.length !== 1 ? "s" : ""}
                            </Text>
                          </Flex>
                        ),
                      }))}
                    />
                  </>
                )}

                <Box mt="3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedPlanId(null);
                      setStep(1);
                    }}
                  >
                    <FaPlusCircle /><Text ml="1">Create New Analysis Plan</Text>
                    
                  </Button>
                </Box>
              </Flex>
            </>
          )}
        </Flex>
      </Step>

      <Step display="Configure Analysis Plan" enabled={true} validate={validateSecondStep}>
        <Flex direction="column" gap="3">
          <Flex direction="column" gap="2">
            <Text weight="bold" size="2">
              Name
            </Text>
            <div className="form-group">
              <input
                type="text"
                className="form-control"
                placeholder="Analysis Plan Name"
                value={form.watch("name")}
                onChange={(e) => form.setValue("name", e.target.value)}
                required
              />
            </div>
            <Text weight="bold" size="2">
              Description
            </Text>
            <div className="form-group">
              <textarea
                className="form-control"
                placeholder="Description (optional)"
                value={form.watch("description")}
                onChange={(e) => form.setValue("description", e.target.value)}
                rows={3}
              />
            </div>
          </Flex>

          <Text weight="bold" size="2" mt="1">
            Rules
          </Text>
          <Text size="2">
            Rules are evaluated in order to determine an experiment status.
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
                  <Grid columns="12" gap="2" align="center">
                    <Flex style={{ gridColumn: "span 1" }} align="center">
                      <Text
                        size="2"
                        color={conditionIndex > 0 ? "gray" : undefined}
                      >
                        {conditionIndex === 0 ? "If" : "AND"}
                      </Text>
                    </Flex>

                    <Flex style={{ gridColumn: "span 2" }} align="center">
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

                    <Flex style={{ gridColumn: "span 3" }} align="center">
                      <Select
                        label=""
                        value={condition.metrics}
                        setValue={(value) =>
                          updateCondition(rule.id, condition.id, "metrics", value)
                        }
                      >
                        {METRICS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </Select>
                    </Flex>

                    <Flex style={{ gridColumn: "span 3" }} align="center">
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
                        {(condition.metrics === "goals" ? GOAL_DIRECTION_OPTIONS : GUARDRAIL_DIRECTION_OPTIONS).map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </Select>
                    </Flex>

                    <Flex style={{ gridColumn: "span 3" }} justify="end">
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
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    color: "var(--accent-9)",
                    fontSize: "0.875rem",
                  }}
                >
                  <FaPlusCircle size={10} /> Add condition
                </Text>
              </Flex>

              <Grid columns="12" gap="2" align="center">
                <Flex style={{ gridColumn: "span 2" }} align="center">
                  <Text weight="medium" size="2">
                    Then
                  </Text>
                </Flex>
                <Flex style={{ gridColumn: "span 10" }} align="center">
                  <Select
                    label=""
                    value={rule.action}
                    setValue={(value) => updateRuleAction(rule.id, value as "ship" | "rollback" | "review")}
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

<Flex justify="start" mt="2">
            <Text
              as="span"
              onClick={handleAddRuleClick}
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                color: "var(--accent-9)",
                fontSize: "0.875rem",
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
            <Flex justify="between" align="center" mb="1">
            <Grid columns="12" gap="1" align="center" width="100%" mt="2">
              <Flex width="100%" justify="start" style={{ gridColumn: "span 1" }}>
                <Text weight="medium" size="2">
                  Otherwise
                </Text>
              </Flex>
              <Flex width="100%" style={{ gridColumn: "span 11" }}>
                <Select
                  label=""
                  value={form.watch("defaultAction")}
                  setValue={(value) => form.setValue("defaultAction", value as "ship" | "rollback" | "review")}
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
        </Flex>
      </Step>
    </PagedModal>
  );
};

export default AnalysisPlanModal;
