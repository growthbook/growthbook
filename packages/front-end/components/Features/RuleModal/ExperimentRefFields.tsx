import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FaExternalLinkAlt } from "react-icons/fa";
import { date } from "shared/dates";
import { getLatestPhaseVariations } from "shared/experiments";
import Link from "next/link";
import React from "react";
import { PiClock } from "react-icons/pi";
import { Box } from "@radix-ui/themes";
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
import ScheduleInputs from "@/components/Features/ScheduleInputs";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";

export default function ExperimentRefFields({
  feature,
  existingRule,
  defaultValues,
  changeRuleType,
  noSchedule,
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
}: {
  feature: FeatureInterface;
  existingRule: boolean;
  defaultValues?: FeatureRule | NewExperimentRefRule;
  changeRuleType: (v: string) => void;
  noSchedule?: boolean;
  scheduleToggleEnabled?: boolean;
  setScheduleToggleEnabled?: (b: boolean) => void;
}) {
  const form = useFormContext();

  const { experiments, experimentsMap } = useExperiments();
  const experimentId = form.watch("experimentId");
  const selectedExperiment = experimentsMap.get(experimentId) || null;

  const experimentOptions = experiments
    .filter(
      (e) =>
        e.type !== "multi-armed-bandit" &&
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
          label="Experiment"
          initialOption="Choose One..."
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
              form.setValue("experimentId", experimentId);
              form.setValue(
                "variations",
                getLatestPhaseVariations(exp).map((v, i) => ({
                  variationId: v.id,
                  value: i ? variationValue : controlValue,
                })),
              );
            }
          }}
          formatOptionLabel={({ value, label }) => {
            const exp = experimentsMap.get(value);
            if (exp) {
              return (
                <div className="d-flex flex-wrap">
                  <div className="flex">
                    <strong>{exp.name}</strong>
                  </div>
                  <div className="ml-4 text-muted">
                    Created: {date(exp.dateCreated)}
                  </div>
                  <div className="ml-auto d-flex align-items-center">
                    <ExperimentStatusIndicator
                      experimentData={exp}
                      labelFormat="status-only"
                    />
                    {!noSchedule ? (
                      <div className="small text-muted ml-3">
                        <PiClock size={14} className="mr-1" />
                        Scheduled
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
        <Callout status="warning" mb="4" contentsAs="div">
          {experiments.length > 0
            ? `You don't have any eligible Experiments yet.`
            : `You don't have any existing Experiments yet.`}{" "}
          <a
            role="button"
            className="link-purple"
            onClick={(e) => {
              e.preventDefault();
              changeRuleType("experiment-ref-new");
            }}
          >
            Create New Experiment
          </a>
        </Callout>
      ) : (
        <Callout status="error" mb="4" contentsAs="div">
          Could not find this Experiment. Has it been deleted?
        </Callout>
      )}
      {selectedExperiment && existingRule && (
        <HelperText status="info" mb="5">
          <Link
            href={`/experiment/${selectedExperiment.id}#overview`}
            target="_blank"
          >
            View this Experiment <FaExternalLinkAlt />
          </Link>{" "}
          to make changes to assignment or targeting conditions.
        </HelperText>
      )}

      {selectedExperiment && (
        <Box px="5" pt="5" pb="1" mb="4" className="bg-highlight rounded">
          <label className="mb-3">Variation Values</label>
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
              useCodeInput={true}
              showFullscreenButton={true}
              codeInputDefaultHeight={80}
            />
          ))}
        </Box>
      )}

      <Field
        label="Description"
        textarea
        minRows={1}
        {...form.register("description")}
        placeholder="Short human-readable description of the rule"
      />

      {!noSchedule && setScheduleToggleEnabled ? (
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
