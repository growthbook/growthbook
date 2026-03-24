import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FaExclamationTriangle } from "react-icons/fa";
import { useState } from "react";
import { PiCaretDownFill, PiCaretUpFill } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { RampScheduleInterface } from "shared/validators";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import RolloutPercentInput from "@/components/Features/RolloutPercentInput";
import SelectField from "@/components/Forms/SelectField";
import { NewExperimentRefRule, useAttributeSchema } from "@/services/features";
import ScheduleInputs from "@/components/Features/ScheduleInputs";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import Checkbox from "@/ui/Checkbox";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Button from "@/ui/Button";
import { useUser } from "@/services/UserContext";
import RampScheduleSection, {
  type RampSectionState,
} from "@/components/Features/RuleModal/RampScheduleSection";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";

export default function RolloutFields({
  feature,
  environments,
  defaultValues,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  conditionKey,
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
  featureRampSchedules,
  ruleRampSchedule,
  rampSectionState,
  setRampSectionState,
}: {
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

  // Fixed-date scheduling is legacy. Only show if the rule already has scheduled dates.
  const hasLegacySchedule = (
    "scheduleRules" in defaultValues ? defaultValues.scheduleRules || [] : []
  ).some((r) => r.timestamp !== null);

  // "scheduling open" encompasses both schedule types; the outer toggle enables either
  const schedulingOpen =
    scheduleToggleEnabled || rampSectionState.mode !== "off";
  // Which tab is active: "fixed" (legacy date picker) or "ramp"
  const [scheduleTab, setScheduleTab] = useState<"fixed" | "ramp">(
    hasLegacySchedule && rampSectionState.mode === "off" ? "fixed" : "ramp",
  );

  function handleSchedulingToggle(enabled: boolean) {
    if (!enabled) {
      setScheduleToggleEnabled(false);
      setRampSectionState({ ...rampSectionState, mode: "off" });
    } else {
      if (hasLegacySchedule && scheduleTab === "fixed") {
        setScheduleToggleEnabled(true);
      } else {
        setRampSectionState({
          ...rampSectionState,
          mode: ruleRampSchedule ? "link" : "create",
        });
      }
    }
  }

  function handleTabChange(tab: "fixed" | "ramp") {
    setScheduleTab(tab);
    if (tab === "fixed") {
      setScheduleToggleEnabled(true);
      setRampSectionState({ ...rampSectionState, mode: "off" });
    } else {
      setScheduleToggleEnabled(false);
      setRampSectionState({
        ...rampSectionState,
        mode: ruleRampSchedule ? "link" : "create",
      });
    }
  }

  const renderOverviewSteps = () => {
    return (
      <>
        <Field
          label="Description"
          textarea
          minRows={1}
          {...form.register("description")}
          placeholder="Short human-readable description of the rule"
        />

        <div className="mb-3 pb-1">
          <FeatureValueField
            label="Value to roll out"
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
        {/* Unified scheduling section */}
        <div className="my-3">
          <Checkbox
            size="lg"
            label={
              <PremiumTooltip commercialFeature="schedule-feature-flag">
                Apply Schedule
              </PremiumTooltip>
            }
            description="Schedule this rule to launch/disable at fixed times, or gradually ramp up coverage"
            value={schedulingOpen}
            setValue={handleSchedulingToggle}
            disabled={!canScheduleFeatureFlags}
          />

          {schedulingOpen && (
            <div className="appbox mt-3 px-3 pt-3 pb-2 bg-light">
              {hasLegacySchedule && (
                /* Tab selector — only shown for rules that already have fixed-date schedules */
                <Flex gap="2" mb="3">
                  <Button
                    variant={scheduleTab === "fixed" ? "solid" : "outline"}
                    size="sm"
                    onClick={() => handleTabChange("fixed")}
                  >
                    Fixed dates
                  </Button>
                  <Button
                    variant={scheduleTab === "ramp" ? "solid" : "outline"}
                    size="sm"
                    onClick={() => handleTabChange("ramp")}
                  >
                    Ramp schedule
                  </Button>
                </Flex>
              )}

              {hasLegacySchedule && scheduleTab === "fixed" && (
                <ScheduleInputs
                  defaultValue={defaultValues.scheduleRules || []}
                  onChange={(value) => form.setValue("scheduleRules", value)}
                  scheduleToggleEnabled={true}
                  setScheduleToggleEnabled={setScheduleToggleEnabled}
                  hideToggle={true}
                />
              )}

              {(!hasLegacySchedule || scheduleTab === "ramp") && (
                <RampScheduleSection
                  featureRampSchedules={featureRampSchedules}
                  ruleRampSchedule={ruleRampSchedule}
                  state={rampSectionState}
                  setState={setRampSectionState}
                  hideOuterToggle={true}
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
                />
              )}
            </div>
          )}
        </div>

        <div className="appbox mt-4 mb-4 px-3 pt-3 bg-light">
          <RolloutPercentInput
            value={form.watch("coverage") || 0}
            setValue={(coverage) => {
              form.setValue("coverage", coverage);
            }}
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
            onChange={(v) => {
              form.setValue("hashAttribute", v);
            }}
            formatOptionLabel={(o, meta) => {
              return (
                <AttributeOptionWithTooltip
                  option={o as AttributeOptionForTooltip}
                  context={meta.context}
                >
                  {o.label}
                </AttributeOptionWithTooltip>
              );
            }}
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
            <code>{cyclicFeatureId}</code>) creates a circular dependency.
            Remove this prerequisite to continue.
          </div>
        )}
      </>
    );
  };

  return <>{renderOverviewSteps()}</>;
}
