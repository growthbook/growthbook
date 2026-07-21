import { useFormContext } from "react-hook-form";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { RampScheduleInterface } from "shared/validators";
import { ensureConfigBacking } from "shared/util";
import { PiLockSimple } from "react-icons/pi";
import { useConfigBacking } from "@/hooks/useConfigBacking";
import Heading from "@/ui/Heading";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import RolloutPercentInput from "@/components/Features/RolloutPercentInput";
import { NewExperimentRefRule, useAttributeSchema } from "@/services/features";
import LegacyScheduleInputs from "@/components/Features/LegacyScheduleInputs";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteInput, {
  type RuleCyclicResult,
} from "@/components/Features/PrerequisiteInput";
import RadioGroup from "@/ui/RadioGroup";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useUser } from "@/services/UserContext";
import Text from "@/ui/Text";
import {
  type RampSectionState,
  defaultRampSectionState,
} from "@/components/Features/RuleModal/RampScheduleSection";
import HelperText from "@/ui/HelperText";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import MonitoredIcon from "@/components/Features/RuleModal/MonitoredIcon";
import RampScheduleBadge from "@/components/RampSchedule/RampScheduleBadge";
import ScheduleInputs from "@/components/Features/RuleModal/ScheduleInputs";
import RuleEnvironmentScopeField, {
  type EnvScopeProps,
} from "@/components/Features/RuleModal/EnvironmentScopeField";
export type ScheduleType = "none" | "schedule" | "ramp";
type ScheduleSelectorType = ScheduleType | "ramp-monitored";

/** Derive the schedule type from existing state on first render. */
export function deriveScheduleType(
  rampSectionState: RampSectionState,
  scheduleToggleEnabled: boolean,
  hasLegacySchedule: boolean,
  persisted: ScheduleSelectorType | undefined,
): ScheduleType {
  if (persisted && persisted !== "none") {
    return persisted === "ramp-monitored" ? "ramp" : persisted;
  }
  if (rampSectionState.mode !== "off") {
    if (rampSectionState.steps.length === 0) return "schedule";
    return "ramp";
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
  setScheduleToggleEnabled,
  ruleRampSchedule,
  rampSectionState,
  setRampSectionState,
  scheduleType,
  setScheduleType,
  envScope,
  isLiveRule,
  isNew,
  onRuleCyclicChange,
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
  envScope: EnvScopeProps;
  isLiveRule?: boolean;
  isNew?: boolean;
  onRuleCyclicChange?: (result: RuleCyclicResult) => void;
}) {
  const form = useFormContext();

  // A config-backed feature default makes every rule an implicit sparse patch on
  // that config. The rule may override with the default's config or a descendant,
  // and the sparse toggle is dropped (rules are always sparse here).
  const { defaultConfigKey, isConfigBacked, configBackingOptionKeys } =
    useConfigBacking(feature);

  // Config-backed rules are always sparse and always serve a config. Seed the
  // value with the default's config (the user can switch to a compatible child)
  // when it isn't already backed.
  useEffect(() => {
    if (!isConfigBacked || !defaultConfigKey) return;
    if (!form.watch("sparse")) form.setValue("sparse", true);
    const v = form.watch("value");
    const normalized = ensureConfigBacking(v, defaultConfigKey);
    if (normalized !== v) form.setValue("value", normalized);
    // Re-run if the default re-points to a different config (else the rule keeps
    // a stale backing key); `form` is stable (react-hook-form).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigBacked, defaultConfigKey]);

  const [advancedOptionsOpen, setadvancedOptionsOpen] = useState(
    !!form.watch("seed") ||
      (!isNew &&
        form.watch("hashVersion") !== undefined &&
        form.watch("hashVersion") !== 2),
  );
  const attributeSchema = useAttributeSchema(false, feature.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;
  const { hasCommercialFeature } = useUser();
  const canScheduleFeatureFlags = hasCommercialFeature("schedule-feature-flag");
  const canUseRampSchedules = hasCommercialFeature("ramp-schedules");

  const isSimpleSchedule =
    !!ruleRampSchedule && ruleRampSchedule.steps.length === 0;
  const showScheduleBadge =
    !!ruleRampSchedule && ruleRampSchedule.status !== "pending";

  const actualScheduleIsMonitored =
    !!ruleRampSchedule && ruleRampSchedule.steps.some((s) => !!s.monitored);

  const hasLegacySchedule = (
    "scheduleRules" in defaultValues ? defaultValues.scheduleRules || [] : []
  ).some((r) => r.timestamp !== null);

  const [savedStates, setSavedStates] = useState<
    Partial<Record<ScheduleType, { ramp: RampSectionState; coverage: number }>>
  >({});

  const rampScheduleEditLocked =
    !!ruleRampSchedule &&
    ruleRampSchedule.status === "running" &&
    !isSimpleSchedule;
  const pendingScheduleRemoval =
    !!ruleRampSchedule && isSimpleSchedule && rampSectionState.mode === "off";
  const releasePlanLocked = rampScheduleEditLocked || pendingScheduleRemoval;
  const selectorScheduleType: ScheduleSelectorType =
    scheduleType === "ramp" && rampSectionState.steps.some((s) => s.monitored)
      ? "ramp-monitored"
      : scheduleType;

  const rampLocksTargeting =
    !isSimpleSchedule && scheduleType === "ramp" && releasePlanLocked;
  const inModalPendingRamp =
    !ruleRampSchedule &&
    scheduleType === "ramp" &&
    rampSectionState.mode === "create" &&
    rampSectionState.steps.length > 0;
  const rampControlsCoverage =
    !isSimpleSchedule &&
    scheduleType === "ramp" &&
    (rampScheduleEditLocked || inModalPendingRamp);

  function applyScheduleType(type: ScheduleSelectorType) {
    const currentCoverage = form.watch("coverage") ?? 1;
    const canonicalType: ScheduleType =
      type === "ramp-monitored" ? "ramp" : type;
    setSavedStates((prev) => ({
      ...prev,
      [scheduleType]: { ramp: rampSectionState, coverage: currentCoverage },
    }));

    setScheduleType(canonicalType);

    const leavingRamp = scheduleType === "ramp";

    if (type === "none") {
      setScheduleToggleEnabled(false);
      setRampSectionState({ ...rampSectionState, mode: "off" });
      const saved = savedStates[type];
      form.setValue(
        "coverage",
        saved?.coverage ?? (leavingRamp ? 1 : currentCoverage),
      );
      return;
    }

    const saved = savedStates[canonicalType];

    if (type === "ramp" || type === "ramp-monitored") {
      setScheduleToggleEnabled(false);

      if (saved && saved.ramp.steps.length > 0) {
        const restoredState = { ...saved.ramp };
        if (type === "ramp-monitored") {
          restoredState.steps = restoredState.steps.map((s) => ({
            ...s,
            monitored: true,
            patch: {
              ...s.patch,
              coverage: Math.min(s.patch.coverage ?? 0, 50),
            },
          }));
        }
        setRampSectionState(restoredState);
      } else {
        const seed = !ruleRampSchedule
          ? defaultRampSectionState(undefined)
          : null;
        const baseState = ruleRampSchedule
          ? rampSectionState
          : defaultRampSectionState(undefined);
        const newState: RampSectionState = {
          ...baseState,
          mode: ruleRampSchedule ? "edit" : "create",
          ...(seed ? { steps: seed.steps, name: seed.name } : {}),
        };

        if (type === "ramp-monitored") {
          newState.steps = newState.steps.map((s) => ({
            ...s,
            monitored: true,
            patch: {
              ...s.patch,
              coverage: Math.min(s.patch.coverage ?? 0, 50),
            },
          }));
        }

        setRampSectionState(newState);
      }
      form.setValue("coverage", 0);
      return;
    }

    setScheduleToggleEnabled(false);
    if (saved) {
      // Start-approval is a ramp-only concept; never carry it into a non-ramp
      // mode, or the rule publishes disabled with no way to clear it here.
      setRampSectionState({ ...saved.ramp, requiresStartApproval: false });
      form.setValue("coverage", saved.coverage);
    } else {
      setRampSectionState({
        ...rampSectionState,
        mode: ruleRampSchedule ? "edit" : "create",
        steps: [],
        startDate: "",
        endScheduleAt: "",
        requiresStartApproval: false,
      });
      if (leavingRamp) form.setValue("coverage", 1);
    }
  }

  return (
    <>
      <Field
        size="legacy"
        label="Description"
        textarea
        minRows={1}
        maxLength={MAX_DESCRIPTION_LENGTH}
        {...form.register("description")}
        placeholder="Short human-readable description of the rule"
      />

      <RuleEnvironmentScopeField {...envScope} my="5" />

      <Box mb="5">
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
          sparse={!!form.watch("sparse")}
          // Config-backed rules are always sparse, so the toggle is dropped and a
          // config picker (restricted to the default's subtree) is offered instead.
          setSparse={
            isConfigBacked ? undefined : (v) => form.setValue("sparse", v)
          }
          allowConfigBacking={isConfigBacked}
          configBackingOptionKeys={configBackingOptionKeys}
          configBackingShowPatch={isConfigBacked}
          lockConfigBacking={isConfigBacked}
        />
      </Box>

      <div className="mb-3">
        <Heading as="h3" size="small" mb="2">
          Release plan
        </Heading>
        {releasePlanLocked && (
          <HelperText status="info" mb="2" icon={<PiLockSimple />}>
            <Box>
              <Text as="div">
                {pendingScheduleRemoval
                  ? "Locked while schedule removal is pending"
                  : `Locked while ${isSimpleSchedule ? "Schedule" : "Ramp-up"} is running`}
              </Text>
              {!pendingScheduleRemoval && (
                <Text as="div" mt="1" size="small">
                  To change the release plan, pause or end the Ramp-up
                </Text>
              )}
            </Box>
          </HelperText>
        )}
        <RadioGroup
          mt="4"
          mb="2"
          gap="2"
          disabled={releasePlanLocked}
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
                  {showScheduleBadge && isSimpleSchedule && (
                    <RampScheduleBadge rs={ruleRampSchedule!} simpleSchedule />
                  )}
                </Flex>
              ),
              description:
                "Turn the rule on or off on specific dates, no gradual rollout",
              disabled: !canScheduleFeatureFlags,
            },
            {
              value: "ramp",
              label: (
                <Flex align="center" gap="2">
                  Ramp-up
                  <PaidFeatureBadge commercialFeature="ramp-schedules" />
                  {showScheduleBadge &&
                    !isSimpleSchedule &&
                    !actualScheduleIsMonitored && (
                      <RampScheduleBadge
                        rs={ruleRampSchedule!}
                        featureRuleContext
                      />
                    )}
                </Flex>
              ),
              description:
                "Gradually increase traffic over time, with optional scheduling",
              disabled: !canUseRampSchedules,
            },
            {
              value: "ramp-monitored",
              label: (
                <Flex align="center" gap="2">
                  <Flex align="center" gap="1">
                    <MonitoredIcon size={16} />
                    Monitored Ramp-up
                  </Flex>
                  <PaidFeatureBadge commercialFeature="safe-rollout" />
                  {showScheduleBadge &&
                    !isSimpleSchedule &&
                    actualScheduleIsMonitored && (
                      <RampScheduleBadge
                        rs={ruleRampSchedule!}
                        featureRuleContext
                      />
                    )}
                </Flex>
              ),
              description:
                "Ramp-up with guardrail monitoring and auto-rollback",
              disabled: !canUseRampSchedules,
            },
          ]}
          value={selectorScheduleType}
          setValue={(v) => applyScheduleType(v as ScheduleSelectorType)}
        />

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
              <>
                {(() => {
                  const isTerminal =
                    !!ruleRampSchedule &&
                    isSimpleSchedule &&
                    ["completed", "rolled-back"].includes(
                      ruleRampSchedule.status,
                    );
                  const isPendingRemoval = rampSectionState.mode === "off";
                  // A running simple schedule's start has already passed, so the
                  // back-end ignores startDate edits — lock the Start row while
                  // still allowing the end date to be changed.
                  const isRunningSimple =
                    !!ruleRampSchedule &&
                    isSimpleSchedule &&
                    ruleRampSchedule.status === "running";
                  return (
                    <>
                      <ScheduleInputs
                        state={rampSectionState}
                        setState={setRampSectionState}
                        disabled={isTerminal || isPendingRemoval}
                        disableStart={isRunningSimple}
                      />
                      {isTerminal && !isPendingRemoval && (
                        <Callout
                          status="info"
                          mt="3"
                          size="sm"
                          action={
                            <Button
                              color="inherit"
                              size="xs"
                              variant="outline"
                              onClick={() =>
                                setRampSectionState({
                                  ...rampSectionState,
                                  mode: "off",
                                })
                              }
                            >
                              Remove schedule
                            </Button>
                          }
                        >
                          This schedule has finished.
                        </Callout>
                      )}
                      {isPendingRemoval && (
                        <Callout status="info" mt="3" size="sm">
                          Schedule will be removed on save.
                        </Callout>
                      )}
                    </>
                  );
                })()}
              </>
            )}
            {isLiveRule &&
              form.watch("enabled") &&
              rampSectionState.startDate &&
              new Date(rampSectionState.startDate).getTime() > Date.now() && (
                <Callout status="warning" mt="4">
                  This rule is currently enabled and will remain live until the
                  schedule starts. Disable the rule first if you don&apos;t want
                  it serving traffic before then.
                </Callout>
              )}
          </Box>
        )}

        {/* Ramp-up schedule editor is rendered on page 2 (see index.tsx) */}
      </div>

      <Heading as="h3" size="small" mb="4" mt="6">
        Targeting
      </Heading>
      {rampLocksTargeting ? (
        <HelperText status="info" mb="2" icon={<PiLockSimple />}>
          <Box>
            <Text as="div">Controlled by ramp schedule</Text>
            <Text as="div" mt="1" size="small">
              Coverage and targeting are controlled by the live ramp schedule.
              Pause or end the ramp-up to make immediate changes.
            </Text>
          </Box>
        </HelperText>
      ) : (
        <Flex direction="column" gap="5" mb="4">
          {rampControlsCoverage ? null : (
            <RolloutPercentInput
              value={form.watch("coverage") ?? 1}
              setValue={(coverage) => form.setValue("coverage", coverage)}
              rampSchedule={ruleRampSchedule}
              hashAttribute={form.watch("hashAttribute")}
              setHashAttribute={(v: string) =>
                form.setValue("hashAttribute", v)
              }
              attributeSchema={attributeSchema}
              hasHashAttributes={hasHashAttributes}
              hashVersion={form.watch("hashVersion") as 1 | 2 | undefined}
              setHashVersion={(v: 1 | 2) => form.setValue("hashVersion", v)}
              project={feature.project}
              seed={form.watch("seed")}
              setSeed={(v: string) => form.setValue("seed", v)}
              ruleId={form.watch("id") as string}
              featureId={feature.id}
              isLiveRule={isLiveRule}
              isNew={isNew}
              advancedOpen={advancedOptionsOpen}
              setAdvancedOpen={setadvancedOptionsOpen}
            />
          )}

          <SavedGroupTargetingField
            value={form.watch("savedGroups") || []}
            setValue={(savedGroups) =>
              form.setValue("savedGroups", savedGroups)
            }
            project={feature.project || ""}
            label="Saved Groups"
          />

          <ConditionInput
            defaultValue={form.watch("condition") || ""}
            onChange={(value) => form.setValue("condition", value)}
            key={conditionKey}
            project={feature.project || ""}
            label="Attributes"
          />

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
            label="Prerequisite Features"
            onRuleCyclicChange={onRuleCyclicChange}
          />
        </Flex>
      )}
      {isCyclic && (
        <Callout status="error">
          A prerequisite (<code>{cyclicFeatureId}</code>) creates a circular
          dependency. Remove this prerequisite to continue.
        </Callout>
      )}
    </>
  );
}
