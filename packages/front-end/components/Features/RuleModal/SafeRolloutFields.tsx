import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { FaExclamationTriangle } from "react-icons/fa";
import { Box, TextField } from "@radix-ui/themes";
import { PiCaretUp, PiCaretDown } from "react-icons/pi";
import { useState } from "react";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import SelectField from "@/components/Forms/SelectField";
import { NewExperimentRefRule, useAttributeSchema } from "@/services/features";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import Checkbox from "@/components/Radix/Checkbox";

export default function SafeRolloutFields({
  feature,
  environment,
  version,
  revisions,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  conditionKey,
  isNewRule,
  step,
  isDraft,
  duplicate,
}: {
  feature: FeatureInterface;
  environment: string;
  defaultValues: FeatureRule | NewExperimentRefRule;
  version: number;
  revisions?: FeatureRevisionInterface[];
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic: boolean;
  cyclicFeatureId: string | null;
  conditionKey: number;
  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (b: boolean) => void;
  step: number;
  isNewRule: boolean;
  isDraft: boolean;
  duplicate: boolean;
}) {
  const form = useFormContext();
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const attributeSchema = useAttributeSchema(false, feature.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;
  const { datasources } = useDefinitions();
  const dataSourceOptions =
    datasources?.map((ds) => ({
      label: ds.name,
      value: ds.id,
    })) || [];
  const dataSource = datasources?.find(
    (ds) => ds.id === form.watch("safeRolloutFields.datasourceId")
  );
  const exposureQueries = dataSource?.settings?.queries?.exposure || [];
  const disableFields = !isDraft && !isNewRule;
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
            value={form.watch("variationValue")}
            setValue={(v) => form.setValue("variationValue", v)}
            valueType={feature.valueType}
            feature={feature}
            renderJSONInline={true}
            disabled={disableFields}
          />
        </div>
        <SelectField
          disabled={disableFields}
          label="Enroll based on attribute"
          options={attributeSchema
            .filter((s) => !hasHashAttributes || s.hashAttribute)
            .map((s) => ({ label: s.property, value: s.property }))}
          value={form.watch("hashAttribute")}
          onChange={(v) => {
            form.setValue("hashAttribute", v);
          }}
          required
        />
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
        <PrerequisiteTargetingField
          value={form.watch("prerequisites") || []}
          setValue={(prerequisites) =>
            form.setValue("prerequisites", prerequisites)
          }
          feature={feature}
          revisions={revisions}
          version={version}
          environments={[environment]}
          setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        />
        {isCyclic && (
          <div className="alert alert-danger">
            <FaExclamationTriangle /> A prerequisite (
            <code>{cyclicFeatureId}</code>) creates a circular dependency.
            Remove this prerequisite to continue.
          </div>
        )}

        {duplicate && !!form.watch("seed") && (
          <div
            className="ml-auto link-purple cursor-pointer mb-2"
            onClick={(e) => {
              e.preventDefault();
              setAdvancedOptionsOpen(!advancedOptionsOpen);
            }}
          >
            Advanced Options{" "}
            {!advancedOptionsOpen ? <PiCaretDown /> : <PiCaretUp />}
          </div>
        )}
        {duplicate && !!form.watch("seed") && advancedOptionsOpen && (
          <div className="ml-2">
            <Checkbox
              value={form.watch("sameSeed")}
              setValue={(value: boolean) => form.setValue("sameSeed", value)}
              label="Same seed"
            />
          </div>
        )}
      </>
    );
  };

  const renderSafeRolloutSteps = () => {
    return (
      <>
        <div className="bg-highlight rounded p-3 mb-3">
          <div className="mb-3 pb-1">
            <SelectField
              label="Data source"
              options={dataSourceOptions}
              value={form.watch("safeRolloutFields.datasourceId")}
              onChange={(v) =>
                form.setValue("safeRolloutFields.datasourceId", v)
              }
              required
              placeholder="Select a data source"
              // Add a disabled state while loading
              disabled={!dataSourceOptions || disableFields}
            />
            {dataSourceOptions.length === 0 && (
              <div className="alert alert-warning mt-2">
                <small>
                  No data sources configured. Please add a data source in the
                  settings.
                </small>
              </div>
            )}
          </div>
          <div className="pb-1">
            <SelectField
              label="Experiment assignment table"
              options={exposureQueries.map((q) => ({
                label: q.name,
                value: q.id,
              }))}
              required
              disabled={
                disableFields || !form.watch("safeRolloutFields.datasourceId")
              }
              value={form.watch("safeRolloutFields.exposureQueryId")}
              onChange={(v) =>
                form.setValue("safeRolloutFields.exposureQueryId", v)
              }
            />
          </div>
        </div>
        <div className="mb-3 pb-1">
          <label>Guardrail metrics</label>
          {/* TODO validate at least one metric is selected */}
          <MetricsSelector
            datasource={form.watch("safeRolloutFields.datasourceId")}
            exposureQueryId={form.watch("safeRolloutFields.exposureQueryId")}
            project={feature.project}
            selected={form.watch("safeRolloutFields.guardrailMetricIds") || []}
            disabled={!form.watch("safeRolloutFields.exposureQueryId")}
            onChange={(v) =>
              form.setValue("safeRolloutFields.guardrailMetricIds", v)
            }
          />
        </div>
        <div className="mb-3 pb-1">
          <label>Duration to monitor</label>
          <Box maxWidth="300px">
            <TextField.Root
              placeholder="7"
              type="number"
              required
              {...form.register("safeRolloutFields.maxDurationDays", {
                valueAsNumber: true,
              })}
            >
              <TextField.Slot></TextField.Slot>
              <TextField.Slot>Days</TextField.Slot>
            </TextField.Root>
          </Box>
        </div>
        <div className="mb-3 pb-1">
          <FeatureValueField
            label="Control value"
            id="controlValue"
            value={form.watch("controlValue")}
            setValue={(v) => form.setValue("controlValue", v)}
            valueType={feature.valueType}
            feature={feature}
            renderJSONInline={true}
            disabled={disableFields}
          />
        </div>
      </>
    );
  };

  return <>{step === 1 ? renderSafeRolloutSteps() : renderOverviewSteps()}</>;
}
