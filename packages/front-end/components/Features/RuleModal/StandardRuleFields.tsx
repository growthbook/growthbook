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
import Text from "@/ui/Text";
import RampScheduleSection, {
  type RampSectionState,
  defaultRampSectionState,
  activeFieldsFromState,
  type StepField,
} from "@/components/Features/RuleModal/RampScheduleSection";
import Callout from "@/ui/Callout";
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
  ruleRampSchedule,
  rampSectionState,
  setRampSectionState,
  scheduleType,
  setScheduleType,
  pendingDetach,
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
  ruleRampSchedule: RampScheduleInterface | undefined;
  rampSectionState: RampSectionState;
  setRampSectionState: (s: RampSectionState) => void;
  scheduleType: ScheduleType;
  setScheduleType: (t: ScheduleType) => void;
  pendingDetach?: boolean;
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

  // Ramp is configured but the activating revision hasn't been published yet (or no DB
  // record at all). Targeting is locked out but hash/seed remain editable.
  const preRampPublish =
    scheduleType === "ramp" &&
    (!ruleRampSchedule || ruleRampSchedule.status === "pending");

  // Ramp exists in the DB and is not yet in a terminal state. Everything ramp-related
  // is locked — including the coverage/hash/seed widget.
  const rampNotComplete =
    !!ruleRampSchedule &&
    !["completed", "rolled-back", "pending"].includes(ruleRampSchedule.status);

  const hasLegacySchedule = (
    "scheduleRules" in defaultValues ? defaultValues.scheduleRules || [] : []
  ).some((r) => r.timestamp !== null);

  const [savedStates, setSavedStates] = useState<
    Partial<Record<ScheduleType, RampSectionState>>
  >({});

  const rampActiveFields = useMemo(
    () => activeFieldsFromState(rampSectionState),
    [rampSectionState],
  );

  const inRamp = scheduleType === "ramp";

  const isRampControlled = (field: StepField) =>
    inRamp && rampActiveFields.has(field);

  function applyScheduleType(type: ScheduleType) {
    setSavedStates((prev) => ({ ...prev, [scheduleType]: rampSectionState }));

    if (scheduleType === "ramp" && type !== "ramp") {
      if (rampActiveFields.has("coverage")) {
        form.setValue("coverage", 1);
      }
    }

    setScheduleType(type);

    if (type === "none") {
      setScheduleToggleEnabled(false);
      setRampSectionState({ ...rampSectionState, mode: "off" });
      return;
    }

    const saved = savedStates[type];

    if (type === "ramp") {
      setScheduleToggleEnabled(false);
      if (saved && saved.steps.length > 0) {
        setRampSectionState(saved);
        if (activeFieldsFromState(saved).has("coverage")) {
          form.setValue("coverage", 0);
        }
      } else {
        const seed = !ruleRampSchedule
          ? defaultRampSectionState(undefined)
          : null;
        const newState: RampSectionState = {
          ...(ruleRampSchedule
            ? rampSectionState
            : defaultRampSectionState(undefined)),
          mode: ruleRampSchedule ? "edit" : "create",
          ...(seed ? { steps: seed.steps, name: seed.name } : {}),
        };
        setRampSectionState(newState);
        if (activeFieldsFromState(newState).has("coverage")) {
          form.setValue("coverage", 0);
        }
      }
      return;
    }

    setScheduleToggleEnabled(false);
    if (saved) {
      setRampSectionState(saved);
    } else {
      setRampSectionState({
        ...rampSectionState,
        mode: ruleRampSchedule ? "edit" : "create",
        steps: [],
        startDate: "",
        endScheduleAt: "",
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

      <div className="mb-3">
        <Heading as="h3" size="small" mb="4">
          Release plan
        </Heading>
        <RadioGroup
          mb="3"
          gap="2"
          options={[
            {
              value: "none",
              label: "Live immediately",
              description: "Rule is always on when enabled",
            },
            {
              value: "schedule",
              label: (
                <Flex align="center" gap="2">
                  Start and end date
                  <PaidFeatureBadge commercialFeature="schedule-feature-flag" />
                </Flex>
              ),
              description: "Enable or disable the rule on specific dates",
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
                "Increase traffic over multiple steps, with optional targeting conditions and approvals",
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
              <RampScheduleDisplay rs={ruleRampSchedule} />
            ) : (
              <RampScheduleSection
                ruleRampSchedule={ruleRampSchedule}
                state={rampSectionState}
                setState={setRampSectionState}
                pendingDetach={pendingDetach}
                embedded
                hideNameField={true}
                feature={feature}
                environments={environments}
              />
            )}
          </>
        )}
      </div>
      <Separator size="4" my="6" />

      {!rampNotComplete && (
        <>
          <RolloutPercentInput
            value={form.watch("coverage") ?? 1}
            setValue={(coverage) => form.setValue("coverage", coverage)}
            lockedByRamp={preRampPublish}
            rampSchedule={ruleRampSchedule}
            hashAttribute={form.watch("hashAttribute")}
            setHashAttribute={(v: string) => form.setValue("hashAttribute", v)}
            attributeSchema={attributeSchema}
            hasHashAttributes={hasHashAttributes}
            seed={form.watch("seed")}
            setSeed={(v: string) => form.setValue("seed", v)}
            featureId={feature.id}
            advancedOpen={advancedOptionsOpen}
            setAdvancedOpen={setadvancedOptionsOpen}
          />
          <Separator size="4" my="5" />
        </>
      )}

      {preRampPublish || rampNotComplete ? (
        <Box>
          <Text as="div" size="medium" weight="semibold" mb="2">
            Targeting is controlled by ramp-up
          </Text>
          <Callout status="info" my="4">
            You can add targeting conditions to individual steps in your ramp-up
            schedule by going to the step&apos;s menu and choosing &ldquo;Add
            additional effects&rdquo;
          </Callout>
        </Box>
      ) : (
        <>
          {isRampControlled("savedGroups") ? (
            <RampControlledField label="Target by Saved Groups" />
          ) : (
            <SavedGroupTargetingField
              value={form.watch("savedGroups") || []}
              setValue={(savedGroups) =>
                form.setValue("savedGroups", savedGroups)
              }
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
              setPrerequisiteTargetingSdkIssues={
                setPrerequisiteTargetingSdkIssues
              }
              label="Target by Prerequisite Features"
            />
          )}
        </>
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
