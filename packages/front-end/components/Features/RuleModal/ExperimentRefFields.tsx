import { useFormContext } from "react-hook-form";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { date } from "shared/dates";
import React from "react";
import { PiArrowSquareOut, PiClock } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  parsePlainJSONObject,
  stripDefaultsForSparse,
  expandSparseToFull,
} from "shared/util";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  useConfigBacking,
  useSeedConfigBackedVariations,
} from "@/hooks/useConfigBacking";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import SelectField from "@/components/Forms/SelectField";
import {
  getDefaultVariationValue,
  getFeatureDefaultValue,
  NewExperimentRefRule,
} from "@/services/features";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useExperiments } from "@/hooks/useExperiments";
import ScheduleInputs from "@/components/Features/LegacyScheduleInputs";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import RuleEnvironmentScopeField, {
  type EnvScopeProps,
} from "@/components/Features/RuleModal/EnvironmentScopeField";
import RuleProjectScopeField, {
  type ProjectScopeProps,
} from "@/components/Features/RuleModal/ProjectScopeField";
import SparsePatchToggle from "@/components/Features/SparsePatchToggle";

export default function ExperimentRefFields({
  kind,
  feature,
  existingRule,
  defaultValues,
  changeRuleType,
  noSchedule,
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
  envScope,
  projectScope,
}: {
  kind: "experiment" | "bandit";
  feature: FeatureInterface;
  existingRule: boolean;
  defaultValues?: FeatureRule | NewExperimentRefRule;
  changeRuleType: (v: string) => void;
  noSchedule?: boolean;
  scheduleToggleEnabled?: boolean;
  setScheduleToggleEnabled?: (b: boolean) => void;
  envScope: EnvScopeProps;
  projectScope: ProjectScopeProps;
}) {
  const { t } = useLingui();
  const form = useFormContext();
  const isBandit = kind === "bandit";
  const showSchedule = !isBandit && !noSchedule;

  const { experiments, experimentsMap } = useExperiments();
  const experimentId = form.watch("experimentId");
  const selectedExperiment = experimentsMap.get(experimentId) || null;
  const selectedExperimentHref = selectedExperiment
    ? `/${kind}/${selectedExperiment.id}#overview`
    : "";

  // Config-backed JSON flags: every arm value is a sparse patch that serves the
  // default's config (the compiler flattens the config under an object arm), so
  // the arms use the config-backing editor, the sparse toggle is dropped, and
  // each arm is seeded with the config backing. Mirrors StandardRuleFields, and
  // corrects rules created via the v2 REST API that carry no `sparse` flag.
  const { defaultConfigKey, isConfigBacked, configBackingOptionKeys } =
    useConfigBacking(feature);
  useSeedConfigBackedVariations(form, { isConfigBacked, defaultConfigKey });

  const experimentOptions = experiments
    .filter(
      (e) =>
        (e.type === "multi-armed-bandit") === isBandit &&
        (e.id === experimentId ||
          (!e.archived &&
            e.status !== "stopped" &&
            (e.project || "") === (feature.project || ""))),
    )
    .sort((a, b) => b.dateCreated.localeCompare(a.dateCreated))
    .map((e) => ({
      label: e.name,
      value: e.id,
    }));

  return (
    <>
      {experimentOptions.length > 0 ? (
        <SelectField
          size="legacy"
          label={isBandit ? t`Bandit` : t`Experiment`}
          initialOption={t`Choose One...`}
          options={experimentOptions}
          readOnly={existingRule}
          disabled={existingRule}
          required
          sort={false}
          value={experimentId || ""}
          onChange={(experimentId) => {
            const exp = experimentsMap.get(experimentId);
            if (exp) {
              const controlValue = getFeatureDefaultValue(feature);
              const variationValue = getDefaultVariationValue(controlValue);
              // When sparse is on (e.g. org default), seed each variation as a
              // clean patch rather than the full default the rule is otherwise
              // populated with.
              const isSparse =
                !!form.watch("sparse") &&
                feature.valueType === "json" &&
                parsePlainJSONObject(controlValue) !== null;
              form.setValue("experimentId", experimentId);
              form.setValue(
                "variations",
                getLatestPhaseVariations(exp).map((v, i) => {
                  const raw = i ? variationValue : controlValue;
                  return {
                    variationId: v.id,
                    value: isSparse
                      ? stripDefaultsForSparse(raw, controlValue)
                      : raw,
                  };
                }),
              );
            }
          }}
          formatOptionLabel={({ value, label }) => {
            const exp = experimentsMap.get(value);
            if (exp) {
              const createdDate = date(exp.dateCreated);
              return (
                <div className="d-flex flex-wrap">
                  <div className="flex">
                    <strong>{exp.name}</strong>
                  </div>
                  <div className="ml-4 text-muted">
                    <Trans>Created: {createdDate}</Trans>
                  </div>
                  <div
                    className={
                      isBandit ? "ml-auto" : "ml-auto d-flex align-items-center"
                    }
                  >
                    <ExperimentStatusIndicator
                      experimentData={exp}
                      labelFormat="status-only"
                    />
                    {showSchedule ? (
                      <div className="small text-muted ml-3">
                        <PiClock size={14} className="mr-1" />
                        <Trans>Scheduled</Trans>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            }
            return label;
          }}
        />
      ) : !existingRule ? (
        <Callout status="warning" mb="4">
          {experiments.length > 0
            ? isBandit
              ? t`You don't have any eligible Bandits yet.`
              : t`You don't have any eligible Experiments yet.`
            : isBandit
              ? t`You don't have any existing Bandits yet.`
              : t`You don't have any existing Experiments yet.`}{" "}
          <a
            role="button"
            className="link-purple"
            onClick={(e) => {
              e.preventDefault();
              changeRuleType("experiment-ref-new");
              if (isBandit) {
                form.setValue("experimentType", "multi-armed-bandit");
              }
            }}
          >
            {isBandit ? (
              <Trans>Create New Bandit</Trans>
            ) : (
              <Trans>Create New Experiment</Trans>
            )}
          </a>
        </Callout>
      ) : (
        <Callout status="error" mb="4">
          {isBandit ? (
            <Trans>Could not find this Bandit. Has it been deleted?</Trans>
          ) : (
            <Trans>Could not find this Experiment. Has it been deleted?</Trans>
          )}
        </Callout>
      )}
      {selectedExperiment && existingRule && (
        <HelperText status="info" mb="5">
          {isBandit ? (
            <Trans>
              <Link href={selectedExperimentHref} target="_blank">
                View this Bandit <PiArrowSquareOut />
              </Link>{" "}
              to make changes to assignment or targeting conditions.
            </Trans>
          ) : (
            <Trans>
              <Link href={selectedExperimentHref} target="_blank">
                View this Experiment <PiArrowSquareOut />
              </Link>{" "}
              to make changes to assignment or targeting conditions.
            </Trans>
          )}
        </HelperText>
      )}

      {selectedExperiment && (
        <Box
          px={isBandit ? "5" : undefined}
          pt={isBandit ? "5" : undefined}
          pb="1"
          mb="4"
          className={
            isBandit && !isConfigBacked ? "bg-highlight rounded" : undefined
          }
        >
          <Flex align="center" gap="3" mb="3">
            <label className="mb-0">
              <Trans>Variation Values</Trans>
            </label>
            {!isConfigBacked &&
              feature.valueType === "json" &&
              parsePlainJSONObject(feature.defaultValue) !== null && (
                <SparsePatchToggle
                  checked={!!form.watch("sparse")}
                  onChange={(checked) => {
                    // Rewrite every variation value so the editor isn't left
                    // with a default-laden patch (on) or a bare patch shown as
                    // the full value (off).
                    const def = feature.defaultValue;
                    (form.getValues("variations") || []).forEach(
                      (variation, i) => {
                        form.setValue(
                          `variations.${i}.value`,
                          checked
                            ? stripDefaultsForSparse(variation.value, def)
                            : expandSparseToFull(variation.value, def),
                        );
                      },
                    );
                    form.setValue("sparse", checked);
                  }}
                />
              )}
          </Flex>
          {getLatestPhaseVariations(selectedExperiment).map((v, i) => (
            <FeatureValueField
              key={v.id}
              label={v.name}
              id={v.id}
              value={form.watch(`variations.${i}.value`) || ""}
              setValue={(v) => form.setValue(`variations.${i}.value`, v)}
              valueType={feature.valueType}
              feature={feature}
              renderJSONInline={false}
              codeInputDefaultHeight={80}
              sparse={!!form.watch("sparse")}
              allowConfigBacking={isConfigBacked}
              configBackingOptionKeys={configBackingOptionKeys}
              configBackingShowPatch={isConfigBacked}
              lockConfigBacking={isConfigBacked}
            />
          ))}
        </Box>
      )}

      <Field
        size="legacy"
        label={t`Description`}
        textarea
        minRows={1}
        maxLength={MAX_DESCRIPTION_LENGTH}
        {...form.register("description")}
        placeholder={t`Short human-readable description of the rule`}
      />

      <RuleEnvironmentScopeField {...envScope} my="5" />
      <RuleProjectScopeField {...projectScope} mb="5" />

      {showSchedule && setScheduleToggleEnabled ? (
        <div className="mt-4 mb-3">
          <ScheduleInputs
            defaultValue={defaultValues?.scheduleRules || []}
            onChange={(value) => form.setValue("scheduleRules", value)}
            scheduleToggleEnabled={!!scheduleToggleEnabled}
            setScheduleToggleEnabled={setScheduleToggleEnabled}
          />
        </div>
      ) : null}
    </>
  );
}
