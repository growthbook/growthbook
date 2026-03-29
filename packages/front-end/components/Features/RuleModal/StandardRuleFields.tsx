// Shared form body for both force and rollout rules.
// ruleType="rollout" enables the coverage/bucketing box and sets the correct
// ramp baseline; ruleType="force" hides it and sets the feature-value baseline.

import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FaExclamationTriangle } from "react-icons/fa";
import { useState, useMemo } from "react";
import { Separator, Box, Flex } from "@radix-ui/themes";
import { RampScheduleInterface } from "shared/validators";
import Heading from "@/ui/Heading";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import RolloutPercentInput from "@/components/Features/RolloutPercentInput";
import { NewExperimentRefRule, useAttributeSchema } from "@/services/features";
import LegacyScheduleInputs from "@/components/Features/LegacyScheduleInputs";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import RadioGroup from "@/ui/RadioGroup";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useUser } from "@/services/UserContext";
import Checkbox from "@/ui/Checkbox";
import RampScheduleSection, {
  type RampSectionState,
  defaultRampSectionState,
  activeFieldsFromState,
  rebuildStateWithActiveFields,
  VALID_STEP_FIELDS,
  type StepField,
} from "@/components/Features/RuleModal/RampScheduleSection";
import RampScheduleDisplay from "@/components/RampSchedule/RampScheduleDisplay";
import ScheduleInputs from "@/components/Features/RuleModal/ScheduleInputs";

export type ScheduleType = "none" | "schedule" | "ramp";

/** Derive the schedule type from existing state on first render. */
export function deriveScheduleType(
  rampSectionState: RampSectionState,
  scheduleToggleEnabled: boolean,
  hasLegacySchedule: boolean,
  persisted: ScheduleType | undefined,
): ScheduleType {
  if (persisted && persisted !== "none") return persisted;
  if (rampSectionState.mode !== "off") {
    return rampSectionState.steps.length > 0 ? "ramp" : "schedule";
  }
  if (scheduleToggleEnabled || hasLegacySchedule) return "schedule";
  return "none";
}

export default function StandardRuleFields({
  ruleType,
  feature,
  environments,
  defaultValues,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  conditionKey,
  scheduleToggleEnabled: _scheduleToggleEnabled,
  setScheduleToggleEnabled,
  featureRampSchedules,
  ruleRampSchedule,
  rampSectionState,
  setRampSectionState,
  scheduleType,
  setScheduleType,
  pendingDetach,
  onChangeRuleType,
}: {
  ruleType: "force" | "rollout";
  feature: FeatureInterface;
  environments: string[];
  defaultValues: FeatureRule | NewExperimentRefRule;
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic: boolean;
  cyclicFeatureId: string | null;
  conditionKey: number;
  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (b: boolean) => void;
  featureRampSchedules: RampScheduleInterface[];
  ruleRampSchedule: RampScheduleInterface | undefined;
  rampSectionState: RampSectionState;
  setRampSectionState: (s: RampSectionState) => void;
  scheduleType: ScheduleType;
  setScheduleType: (t: ScheduleType) => void;
  pendingDetach?: boolean;
  onChangeRuleType?: (v: string) => void;
}) {
  const form = useFormContext();
  const [advancedOptionsOpen, setadvancedOptionsOpen] = useState(
    !!form.watch("seed"),
  );
  const attributeSchema = useAttributeSchema(false, feature.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;
  const { hasCommercialFeature } = useUser();
  const canScheduleFeatureFlags = hasCommercialFeature("schedule-feature-flag");
  const canUseRampSchedules = hasCommercialFeature("ramp-schedules");

  const rampIsEditable =
    !ruleRampSchedule ||
    !["running", "pending-approval"].includes(ruleRampSchedule.status);

  const hasLegacySchedule = (
    "scheduleRules" in defaultValues ? defaultValues.scheduleRules || [] : []
  ).some((r) => r.timestamp !== null);

  const [savedStates, setSavedStates] = useState<
    Partial<Record<ScheduleType, RampSectionState>>
  >({});

  // Derive which fields the ramp is currently controlling.
  const rampActiveFields = useMemo(
    () => activeFieldsFromState(rampSectionState),
    [rampSectionState],
  );

  // Toggle a field into/out of ramp control. When enabled, the current baseline
  // value is seeded into every step so the user can edit per-step from there.
  // Coverage is special: when enabled, set the rule's coverage to 0% since the
  // ramp will control it. When disabled, restore it to 100%.
  function toggleRampField(field: StepField, enabled: boolean) {
    const current = rampActiveFields;
    const newFields: StepField[] = enabled
      ? [...new Set([...current, field])]
      : [...current].filter((f) => f !== field);

    // When enabling coverage in a ramp, set the rule's coverage to 0%
    // When disabling coverage from a ramp, restore it to 100%
    if (field === "coverage") {
      form.setValue("coverage", enabled ? 0 : 1);
    }

    setRampSectionState(
      rebuildStateWithActiveFields(rampSectionState, newFields, {
        condition: form.watch("condition") ?? "{}",
        savedGroups: form.watch("savedGroups") ?? [],
        prerequisites: form.watch("prerequisites") ?? [],
        force: form.watch("value") ?? "",
      }),
    );
  }

  const inRamp = scheduleType === "ramp";

  const isRampControlled = (field: StepField) =>
    inRamp && rampActiveFields.has(field);

  function applyScheduleType(type: ScheduleType) {
    // Snapshot the current state for the type we're leaving so we can restore it.
    setSavedStates((prev) => ({ ...prev, [scheduleType]: rampSectionState }));

    // If leaving ramp mode and coverage was controlled, restore coverage to 100%
    if (scheduleType === "ramp" && type !== "ramp") {
      const currentActiveFields = rampActiveFields;
      if (currentActiveFields.has("coverage")) {
        form.setValue("coverage", 1);
      }
    }

    setScheduleType(type);

    if (type === "none") {
      setScheduleToggleEnabled(false);
      setRampSectionState({ ...rampSectionState, mode: "off" });
      return;
    }

    // Restore a previously saved state for this type if one exists.
    const saved = savedStates[type];

    if (type === "ramp") {
      setScheduleToggleEnabled(false);
      if (saved && saved.steps.length > 0) {
        setRampSectionState(saved);
        // If coverage is in the active fields, set rule coverage to 0
        const savedActiveFields = activeFieldsFromState(saved);
        if (savedActiveFields.has("coverage")) {
          form.setValue("coverage", 0);
        }
      } else {
        // Always reset to preset[0] when entering ramp fresh.
        const seed = !ruleRampSchedule
          ? defaultRampSectionState(undefined)
          : null;
        const nextMode = ruleRampSchedule ? "edit" : "create";
        const newState: RampSectionState = {
          ...(ruleRampSchedule
            ? rampSectionState
            : defaultRampSectionState(undefined)),
          mode: nextMode,
          ...(seed
            ? {
                steps: seed.steps,
                name: seed.name,
                startPatch: seed.startPatch,
              }
            : {}),
        };
        setRampSectionState(newState);
        // If coverage is in the active fields, set rule coverage to 0
        const newActiveFields = activeFieldsFromState(newState);
        if (newActiveFields.has("coverage")) {
          form.setValue("coverage", 0);
        }
      }
      return;
    }

    // "schedule" — restore saved state or reset to blank.
    setScheduleToggleEnabled(false);
    if (saved) {
      setRampSectionState(saved);
    } else {
      setRampSectionState({
        ...rampSectionState,
        mode: ruleRampSchedule ? "edit" : "create",
        steps: [],
        endEarlyWhenStepsComplete: false,
        startMode: "immediately",
        startTime: "",
        endScheduleAt: "",
        disableRuleBefore: false,
        disableRuleAfter: false,
      });
    }
  }

  return (
    <>
      <Field
        label="Description"
        textarea
        minRows={1}
        {...form.register("description")}
        placeholder="Short human-readable description of the rule"
      />

      {inRamp && (
        <label style={{ display: "block" }}>
          <Flex justify="between" align="center" style={{ width: "100%" }}>
            <span>{`Value to ${ruleType === "rollout" ? "roll out" : "force"}`}</span>
            <Checkbox
              value={rampActiveFields.has("force")}
              setValue={(v) => toggleRampField("force", v)}
              label="Ramp up"
              weight="regular"
              disabled={!rampIsEditable}
            />
          </Flex>
        </label>
      )}
      <FeatureValueField
        label={
          inRamp
            ? undefined
            : `Value to ${ruleType === "rollout" ? "roll out" : "force"}`
        }
        id="value"
        value={form.watch("value")}
        setValue={(v) => form.setValue("value", v)}
        valueType={feature.valueType}
        feature={feature}
        renderJSONInline={true}
        useCodeInput={true}
        showFullscreenButton={true}
        disabled={isRampControlled("force")}
      />

      <Box mt="3" mb="8">
        <RolloutPercentInput
          value={form.watch("coverage") ?? 1}
          setValue={(coverage) => form.setValue("coverage", coverage)}
          locked={isRampControlled("coverage")}
          labelActions={
            inRamp && VALID_STEP_FIELDS.includes("coverage") ? (
              <Checkbox
                value={rampActiveFields.has("coverage")}
                setValue={(v) => toggleRampField("coverage", v)}
                label="Ramp up"
                weight="regular"
                disabled={!rampIsEditable}
              />
            ) : undefined
          }
          hashAttribute={form.watch("hashAttribute")}
          setHashAttribute={(v) => form.setValue("hashAttribute", v)}
          attributeSchema={attributeSchema}
          hasHashAttributes={hasHashAttributes}
          seed={form.watch("seed")}
          setSeed={(v) => form.setValue("seed", v)}
          featureId={feature.id}
          advancedOpen={advancedOptionsOpen}
          setAdvancedOpen={setadvancedOptionsOpen}
        />
      </Box>

      {/* Scheduling section */}
      <div className="mb-3">
        <RadioGroup
          mb="3"
          gap="2"
          options={[
            {
              value: "none",
              label: "No schedule",
              description: "Rule is always on when enabled",
            },
            {
              value: "schedule",
              label: (
                <Flex align="center" gap="2">
                  Schedule
                  <PaidFeatureBadge commercialFeature="schedule-feature-flag" />
                </Flex>
              ),
              description: "Define a start and end date",
              disabled: !canScheduleFeatureFlags,
            },
            {
              value: "ramp",
              label: (
                <Flex align="center" gap="2">
                  Ramp-up
                  <PaidFeatureBadge commercialFeature="ramp-schedules" />
                </Flex>
              ),
              description:
                "Define multiple steps with optional targeting conditions and approvals",
              disabled: !canUseRampSchedules,
            },
          ]}
          value={scheduleType}
          setValue={(v) => applyScheduleType(v as ScheduleType)}
        />

        {scheduleType !== "none" && <Separator size="4" my="6" />}

        {scheduleType === "schedule" && (
          <Box my="6">
            {hasLegacySchedule ? (
              <LegacyScheduleInputs
                defaultValue={defaultValues.scheduleRules || []}
                onChange={(value) => form.setValue("scheduleRules", value)}
                scheduleToggleEnabled={true}
                setScheduleToggleEnabled={setScheduleToggleEnabled}
                hideToggle={true}
              />
            ) : (
              <ScheduleInputs
                state={rampSectionState}
                setState={setRampSectionState}
              />
            )}
          </Box>
        )}

        {scheduleType === "ramp" && (
          <>
            <Heading as="h3" size="small" mb="4">
              Ramp-up
            </Heading>
            {ruleRampSchedule && !rampIsEditable ? (
              <RampScheduleDisplay rs={ruleRampSchedule} defaultOpen={true} />
            ) : (
              <RampScheduleSection
                featureRampSchedules={featureRampSchedules}
                ruleRampSchedule={ruleRampSchedule}
                state={rampSectionState}
                setState={setRampSectionState}
                pendingDetach={pendingDetach}
                hideOuterToggle={true}
                hideNameField={true}
                feature={feature}
                environments={environments}
                onSetRuleCoverage={(v) => form.setValue("coverage", v)}
                ruleBaseline={{
                  condition: form.watch("condition") ?? "{}",
                  savedGroups: form.watch("savedGroups") ?? [],
                  prerequisites: form.watch("prerequisites") ?? [],
                  force: form.watch("value") ?? "",
                }}
                ruleType={ruleType}
                onConvertToRollout={
                  ruleType === "force" && onChangeRuleType
                    ? () => onChangeRuleType("rollout")
                    : undefined
                }
              />
            )}
          </>
        )}
      </div>
      <Separator size="4" my="5" />

      <SavedGroupTargetingField
        value={form.watch("savedGroups") || []}
        setValue={(savedGroups) => form.setValue("savedGroups", savedGroups)}
        project={feature.project || ""}
        label="Target by Saved Groups"
        labelActions={
          inRamp && VALID_STEP_FIELDS.includes("savedGroups") ? (
            <Checkbox
              value={rampActiveFields.has("savedGroups")}
              setValue={(v) => toggleRampField("savedGroups", v)}
              label="Ramp up"
              weight="regular"
              disabled={!rampIsEditable}
            />
          ) : undefined
        }
        locked={isRampControlled("savedGroups")}
      />
      <Separator size="4" my="5" />
      <ConditionInput
        defaultValue={form.watch("condition") || ""}
        onChange={(value) => form.setValue("condition", value)}
        key={conditionKey}
        project={feature.project || ""}
        label="Target by Attributes"
        labelActions={
          inRamp && VALID_STEP_FIELDS.includes("condition") ? (
            <Checkbox
              value={rampActiveFields.has("condition")}
              setValue={(v) => toggleRampField("condition", v)}
              label="Ramp up"
              weight="regular"
              disabled={!rampIsEditable}
            />
          ) : undefined
        }
        locked={isRampControlled("condition")}
      />
      <Separator size="4" my="5" />
      <PrerequisiteInput
        value={form.watch("prerequisites") || []}
        setValue={(prerequisites) =>
          form.setValue("prerequisites", prerequisites)
        }
        feature={feature}
        environments={environments}
        setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        label="Target by Prerequisite Features"
        labelActions={
          inRamp ? (
            <Checkbox
              value={rampActiveFields.has("prerequisites")}
              setValue={(v) => toggleRampField("prerequisites", v)}
              label="Ramp up"
              weight="regular"
              disabled={!rampIsEditable}
            />
          ) : undefined
        }
        locked={isRampControlled("prerequisites")}
      />
      {isCyclic && (
        <div className="alert alert-danger">
          <FaExclamationTriangle /> A prerequisite (
          <code>{cyclicFeatureId}</code>) creates a circular dependency. Remove
          this prerequisite to continue.
        </div>
      )}
    </>
  );
}
