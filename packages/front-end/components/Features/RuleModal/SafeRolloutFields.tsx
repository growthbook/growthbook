import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { FaExclamationTriangle } from "react-icons/fa";
import { Box, TextField } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import RolloutPercentInput from "@/components/Features/RolloutPercentInput";
import SelectField from "@/components/Forms/SelectField";
import { NewExperimentRefRule, useAttributeSchema } from "@/services/features";
import ScheduleInputs from "@/components/Features/ScheduleInputs";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import Checkbox from "@/components/Radix/Checkbox";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
export default function SafeRolloutFields({
  feature,
  environment,
  defaultValues,
  version,
  revisions,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  conditionKey,
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
  step,
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
}) {
  const form = useFormContext();
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
    (ds) => ds.id === form.watch("datasource")
  );
  const exposureQueries = dataSource?.settings?.queries?.exposure || [];

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
          />
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
              value={form.watch("datasource")}
              onChange={(v) => form.setValue("datasource", v)}
              required
              placeholder="Select a data source"
              // Add a disabled state while loading
              disabled={!dataSourceOptions}
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
              value={form.watch("exposureQueryId")}
              onChange={(v) => form.setValue("exposureQueryId", v)}
            />
          </div>
        </div>
        <div className="mb-3 pb-1">
          <label>Guardrail metrics</label>
          <MetricsSelector
            datasource={form.watch("datasource")}
            exposureQueryId={form.watch("exposureQueryId")}
            project={feature.project}
            selected={form.watch("guardrailMetrics") || []}
            onChange={(v) => form.setValue("guardrailMetrics", v)}
          />
        </div>
        <div className="mb-3 pb-1">
          <label>Duration to monitor</label>
          <Box maxWidth="300px">
            <TextField.Root
              type="number"
              value={form.watch("maxDurationDays")}
              onChange={(e) =>
                form.setValue("maxDurationDays", parseInt(e.target.value) || 0)
              }
            >
              <TextField.Slot></TextField.Slot>
              <TextField.Slot>Days</TextField.Slot>
            </TextField.Root>
          </Box>
        </div>
        <div className="mb-3 pb-1">
          <FeatureValueField
            label="Control value"
            id="value"
            value={form.watch("controlValue")}
            setValue={(v) => form.setValue("controlValue", v)}
            valueType={feature.valueType}
            feature={feature}
            renderJSONInline={true}
          />
        </div>
      </>
    );
  };

  return <>{step === 1 ? renderSafeRolloutSteps() : renderOverviewSteps()}</>;
}
