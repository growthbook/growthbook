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
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import RampScheduleSection, {
  type RampSectionState,
  defaultRampSectionState,
  activeFieldsFromState,
  rebuildStateWithActiveFields,
  STEP_FIELD_LABELS,
  VALID_STEP_FIELDS,
  type StepField,
} from "@/components/Features/RuleModal/RampScheduleSection";
import RampScheduleDisplay from "@/components/RampSchedule/RampScheduleDisplay";
import ScheduleInputs from "@/components/Features/RuleModal/ScheduleInputs";

export type ScheduleType = "none" | "schedule" | "ramp";

function RampControlledField({ label }: { label: string }) {
  return (
    <Box>
      <Text as="div" size="medium" weight="semibold" mb="2">
        {label}
      </Text>
      <Text as="div" fontStyle="italic" color="text-mid">
        Controlled by ramp-up schedule
      </Text>
    </Box>
  );
}

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

      <FeatureValueField
        label={
          <>
            {`Value to ${ruleType === "rollout" ? "roll out" : "force"}`}
            {isRampControlled("force") && (
              <Text as="div" fontStyle="italic" color="text-mid" mt="1">
                Controlled by ramp-up schedule
              </Text>
            )}
          </>
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
              renderOutsideItem: true,
              renderOnSelect: (
                <Box mt="3" ml="5">
                  <Box mb="2">
                    <Text as="div" size="medium" weight="medium" mb="1">
                      Properties to ramp up
                    </Text>
                    <Text as="div" size="small">
                      Will be controlled by the ramp-up schedule and cannot be
                      globally set
                    </Text>
                  </Box>
                  <MultiSelectField
                    value={VALID_STEP_FIELDS.filter((f) =>
                      rampActiveFields.has(f),
                    )}
                    options={VALID_STEP_FIELDS.map((f) => ({
                      value: f,
                      label: STEP_FIELD_LABELS[f],
                    }))}
                    onChange={(newValues) => {
                      const newFields = newValues as StepField[];
                      const wasActive = rampActiveFields.has("coverage");
                      const willBeActive = newFields.includes("coverage");
                      if (!wasActive && willBeActive)
                        form.setValue("coverage", 0);
                      if (wasActive && !willBeActive)
                        form.setValue("coverage", 1);
                      setRampSectionState(
                        rebuildStateWithActiveFields(
                          rampSectionState,
                          newFields,
                          {
                            condition: form.watch("condition") ?? "{}",
                            savedGroups: form.watch("savedGroups") ?? [],
                            prerequisites: form.watch("prerequisites") ?? [],
                            force: form.watch("value") ?? "",
                          },
                        ),
                      );
                    }}
                    sort={false}
                    showCopyButton={false}
                    closeMenuOnSelect={false}
                    containerClassName="mb-0"
                  />
                  {VALID_STEP_FIELDS.includes("coverage") &&
                    !rampActiveFields.has("coverage") && (
                      <Box mt="2">
                        <Link
                          onClick={() => {
                            form.setValue("coverage", 0);
                            setRampSectionState(
                              rebuildStateWithActiveFields(
                                rampSectionState,
                                [...Array.from(rampActiveFields), "coverage"],
                                {
                                  condition: form.watch("condition") ?? "{}",
                                  savedGroups: form.watch("savedGroups") ?? [],
                                  prerequisites:
                                    form.watch("prerequisites") ?? [],
                                  force: form.watch("value") ?? "",
                                },
                              ),
                            );
                          }}
                        >
                          Add <strong>Rollout %</strong>
                        </Link>
                      </Box>
                    )}
                </Box>
              ),
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
              <RampScheduleDisplay rs={ruleRampSchedule} />
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

      <RolloutPercentInput
        value={form.watch("coverage") ?? 1}
        setValue={(coverage) => form.setValue("coverage", coverage)}
        lockedByRamp={isRampControlled("coverage")}
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
      <Separator size="4" my="5" />

      {isRampControlled("savedGroups") ? (
        <RampControlledField label="Target by Saved Groups" />
      ) : (
        <SavedGroupTargetingField
          value={form.watch("savedGroups") || []}
          setValue={(savedGroups) => form.setValue("savedGroups", savedGroups)}
          project={feature.project || ""}
          label="Target by Saved Groups"
        />
      )}
      <Separator size="4" my="5" />

      {isRampControlled("condition") ? (
        <RampControlledField label="Target by Attributes" />
      ) : (
        <ConditionInput
          defaultValue={form.watch("condition") || ""}
          onChange={(value) => form.setValue("condition", value)}
          key={conditionKey}
          project={feature.project || ""}
          label="Target by Attributes"
        />
      )}
      <Separator size="4" my="5" />

      {isRampControlled("prerequisites") ? (
        <RampControlledField label="Target by Prerequisite Features" />
      ) : (
        <PrerequisiteInput
          value={form.watch("prerequisites") || []}
          setValue={(prerequisites) =>
            form.setValue("prerequisites", prerequisites)
          }
          feature={feature}
          environments={environments}
          setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
          label="Target by Prerequisite Features"
        />
      )}
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
