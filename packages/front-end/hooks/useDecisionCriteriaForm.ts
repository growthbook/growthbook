import { useForm } from "react-hook-form";
import { useEffect } from "react";
import {
  DecisionCriteriaInterface,
  DecisionCriteriaCondition,
  DecisionCriteriaRule,
  DecisionCriteriaData,
} from "shared/enterprise";
import { useAuth } from "@/services/auth";

// UI version with key for tracking
interface DecisionCriteriaConditionUI extends DecisionCriteriaCondition {
  key: string; // For UI tracking
}

// UI version with key for tracking
interface DecisionCriteriaRuleUI extends DecisionCriteriaRule {
  key: string; // For UI tracking
  conditions: DecisionCriteriaConditionUI[];
}

interface DecisionCriteriaFormData
  extends Pick<
    DecisionCriteriaInterface,
    "name" | "description" | "rules" | "defaultAction"
  > {
  rules: DecisionCriteriaRuleUI[];
}

interface UseDecisionCriteriaFormProps {
  decisionCriteria?: DecisionCriteriaData;
  mutate: () => void;
}

export const useDecisionCriteriaForm = ({
  decisionCriteria,
  mutate,
}: UseDecisionCriteriaFormProps) => {
  const { apiCall } = useAuth();

  // Initialize form with empty values first
  const form = useForm<DecisionCriteriaFormData>({
    defaultValues: {
      name: "",
      description: "",
      defaultAction: "review",
      rules: [],
    },
  });

  // Generate a unique key for each rule and condition
  const generateKey = () => `key-${Math.floor(Math.random() * 1000000)}`;

  // Create a default condition
  const createDefaultCondition = (): DecisionCriteriaConditionUI => ({
    key: generateKey(),
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
            key: generateKey(),
            conditions: rule.conditions.map((condition) => ({
              ...condition,
              key: generateKey(),
            })),
          }))
        : [
            {
              key: generateKey(),
              conditions: [createDefaultCondition()],
              action: "ship",
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
        key: generateKey(),
        conditions: [createDefaultCondition()],
        action: "review",
      },
    ]);
  };

  const removeRule = (key: string) => {
    const currentRules = form.getValues("rules");
    if (currentRules.length <= 1) return; // Ensure at least one rule remains
    form.setValue(
      "rules",
      currentRules.filter((rule) => rule.key !== key),
    );
  };

  const addCondition = (ruleKey: string) => {
    const currentRules = form.getValues("rules");
    form.setValue(
      "rules",
      currentRules.map((rule) =>
        rule.key === ruleKey
          ? {
              ...rule,
              conditions: [...rule.conditions, createDefaultCondition()],
            }
          : rule,
      ),
    );
  };

  const removeCondition = (ruleKey: string, conditionKey: string) => {
    const currentRules = form.getValues("rules");
    form.setValue(
      "rules",
      currentRules.map((rule) => {
        if (rule.key !== ruleKey) return rule;

        // Ensure at least one condition remains
        if (rule.conditions.length <= 1) return rule;

        return {
          ...rule,
          conditions: rule.conditions.filter(
            (condition) => condition.key !== conditionKey,
          ),
        };
      }),
    );
  };

  const updateCondition = (
    ruleKey: string,
    conditionKey: string,
    field: keyof Omit<DecisionCriteriaConditionUI, "key">,
    value: string,
  ) => {
    const currentRules = form.getValues("rules");
    form.setValue(
      "rules",
      currentRules.map((rule) => {
        if (rule.key !== ruleKey) return rule;

        return {
          ...rule,
          conditions: rule.conditions.map((condition) =>
            condition.key === conditionKey
              ? { ...condition, [field]: value }
              : condition,
          ),
        };
      }),
    );
  };

  const updateRuleAction = (
    ruleKey: string,
    value: "ship" | "rollback" | "review",
  ) => {
    const currentRules = form.getValues("rules");
    form.setValue(
      "rules",
      currentRules.map((rule) =>
        rule.key === ruleKey ? { ...rule, action: value } : rule,
      ),
    );
  };

  const handleSave = async () => {
    const formData = form.getValues();

    // Strip the IDs from rules and conditions before saving
    const rulesToSave = formData.rules.map(
      ({ key: _, conditions, action }) => ({
        conditions: conditions.map(
          ({ key: _, ...conditionRest }) => conditionRest,
        ),
        action,
      }),
    );

    // validate no guardrail has statsig winner
    const guardrailWithStatsigWinner = rulesToSave.some((rule) =>
      rule.conditions.some(
        (condition) =>
          condition.metrics === "guardrails" &&
          condition.direction === "statsigWinner",
      ),
    );
    if (guardrailWithStatsigWinner) {
      throw new Error(
        "Guardrails cannot be checked for Stat Sig Good results.",
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

  return {
    form,
    addRule,
    removeRule,
    addCondition,
    removeCondition,
    updateCondition,
    updateRuleAction,
    handleSave,
  };
};
