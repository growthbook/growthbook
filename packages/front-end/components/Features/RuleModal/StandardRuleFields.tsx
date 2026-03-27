// Shared form body for both force and rollout rules.
// ruleType="rollout" enables the coverage/bucketing box and sets the correct
// ramp baseline; ruleType="force" hides it and sets the feature-value baseline.

import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FaExclamationTriangle } from "react-icons/fa";
import { useState } from "react";
import { PiCaretDownFill, PiCaretUpFill } from "react-icons/pi";
import { Flex, Separator, Box } from "@radix-ui/themes";
import { RampScheduleInterface } from "shared/validators";
import Heading from "@/ui/Heading";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import RolloutPercentInput from "@/components/Features/RolloutPercentInput";
import SelectField from "@/components/Forms/SelectField";
import { NewExperimentRefRule, useAttributeSchema } from "@/services/features";
import LegacyScheduleInputs from "@/components/Features/LegacyScheduleInputs";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import RadioGroup from "@/ui/RadioGroup";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useUser } from "@/services/UserContext";
import RampScheduleSection, {
  type RampSectionState,
  defaultRampSectionState,
} from "@/components/Features/RuleModal/RampScheduleSection";
import ScheduleInputs from "@/components/Features/RuleModal/ScheduleInputs";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";

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

  const hasLegacySchedule = (
    "scheduleRules" in defaultValues ? defaultValues.scheduleRules || [] : []
  ).some((r) => r.timestamp !== null);

  function applyScheduleType(type: ScheduleType) {
    setScheduleType(type);

    if (type === "none") {
      setScheduleToggleEnabled(false);
      setRampSectionState({ ...rampSectionState, mode: "off" });
      return;
    }

    if (type === "ramp") {
      setScheduleToggleEnabled(false);
      const nextMode = ruleRampSchedule ? "edit" : "create";
      if (
        rampSectionState.mode === "off" ||
        rampSectionState.steps.length === 0
      ) {
        // Re-seed with default preset steps when coming from "off" or from the
        // step-less "schedule" state so the step grid is never blank.
        const seed = !ruleRampSchedule
          ? defaultRampSectionState(undefined)
          : null;
        setRampSectionState({
          ...rampSectionState,
          mode: nextMode,
          ...(seed && rampSectionState.steps.length === 0
            ? { steps: seed.steps, name: seed.name }
            : {}),
        });
      }
      return;
    }

    // "schedule" — 0-step ramp, start/end dates only.
    // Always clear steps regardless of current mode so isScheduleMode is reliably true on save.
    setScheduleToggleEnabled(false);
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

  return (
    <>
      <Field
        label="Description"
        textarea
        minRows={1}
        {...form.register("description")}
        placeholder="Short human-readable description of the rule"
      />

      <div className="pb-1">
        <FeatureValueField
          label={`Value to ${ruleType === "rollout" ? "roll out" : "force"}`}
          id="value"
          value={form.watch("value")}
          setValue={(v) => form.setValue("value", v)}
          valueType={feature.valueType}
          feature={feature}
          renderJSONInline={true}
          useCodeInput={true}
          showFullscreenButton={true}
        />
      </div>

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
                coverage: form.watch("coverage") ?? 0,
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
            <Separator size="4" my="6" />
          </>
        )}
      </div>

      {/* Coverage % + bucketing attribute — always shown for both force and rollout */}
      <div className="appbox mt-4 mb-4 px-3 pt-3 bg-light">
        <RolloutPercentInput
          value={form.watch("coverage") ?? 1}
          setValue={(coverage) => form.setValue("coverage", coverage)}
          className="mb-3"
        />
        <SelectField
          withRadixThemedPortal
          label="Sample based on attribute"
          options={attributeSchema
            .filter((s) => !hasHashAttributes || s.hashAttribute)
            .map((s) => ({
              label: s.property,
              value: s.property,
              description: s.description,
              tags: s.tags,
              datatype: s.datatype,
              hashAttribute: s.hashAttribute,
            }))}
          value={form.watch("hashAttribute")}
          onChange={(v) => form.setValue("hashAttribute", v)}
          formatOptionLabel={(o, meta) => (
            <AttributeOptionWithTooltip
              option={o as AttributeOptionForTooltip}
              context={meta.context}
            >
              {o.label}
            </AttributeOptionWithTooltip>
          )}
        />
        <div className="mb-2">
          <span
            className="ml-auto link-purple cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setadvancedOptionsOpen(!advancedOptionsOpen);
            }}
          >
            {!advancedOptionsOpen ? (
              <PiCaretDownFill className="mr-1" />
            ) : (
              <PiCaretUpFill className="mr-1" />
            )}
            Advanced Options
          </span>
          {advancedOptionsOpen && (
            <div className="mt-3">
              <Field
                label="Seed"
                type="input"
                {...form.register("seed")}
                placeholder={feature.id}
                helpText={
                  <>
                    <strong className="text-danger">Warning:</strong> Changing
                    this will re-randomize rollout traffic.
                  </>
                }
              />
            </div>
          )}
        </div>
      </div>

      <SavedGroupTargetingField
        value={form.watch("savedGroups") || []}
        setValue={(savedGroups) => form.setValue("savedGroups", savedGroups)}
        project={feature.project || ""}
      />
      <hr />
      <ConditionInput
        defaultValue={form.watch("condition") || ""}
        onChange={(value) => form.setValue("condition", value)}
        key={conditionKey}
        project={feature.project || ""}
      />
      <hr />
      <PrerequisiteInput
        value={form.watch("prerequisites") || []}
        setValue={(prerequisites) =>
          form.setValue("prerequisites", prerequisites)
        }
        feature={feature}
        environments={environments}
        setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
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
