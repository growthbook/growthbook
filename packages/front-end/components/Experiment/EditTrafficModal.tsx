import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { useAttributeSchema } from "@/services/features";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HashVersionSelector from "./HashVersionSelector";
import MakeChangesFlow from "./MakeChangesFlow";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
}

export default function EditTrafficModal({
  close,
  experiment,
  mutate,
  safeToEdit,
}: Props) {
  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment);

  const attributeSchema = useAttributeSchema(false, experiment.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const hashAttributeOptions: AttributeOptionForTooltip[] = attributeSchema
    .filter((s) => !hasHashAttributes || s.hashAttribute)
    .map((s) => ({
      label: s.property,
      value: s.property,
      description: s.description,
      tags: s.tags,
      datatype: s.datatype,
      hashAttribute: s.hashAttribute,
    }));

  // If the current hashAttribute isn't in the list, add it for backwards
  // compatibility (e.g. the attribute was archived or removed from the
  // experiment's project after creation).
  if (
    form.watch("hashAttribute") &&
    !hashAttributeOptions.find((o) => o.value === form.watch("hashAttribute"))
  ) {
    hashAttributeOptions.push({
      label: form.watch("hashAttribute"),
      value: form.watch("hashAttribute"),
    });
  }

  const settings = useOrgSettings();
  const { getDatasourceById } = useDefinitions();
  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;
  const supportsSQL = datasource?.properties?.queryLanguage === "sql";

  const orgStickyBucketing = !!settings.useStickyBucketing;
  const isBandit = experiment.type === "multi-armed-bandit";

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header="Edit Traffic"
        ctaEnabled={canSubmit}
        submit={onSubmit(mutate, "traffic")}
        size="lg"
      >
        <div className="pt-2">
          <Field
            label="Tracking Key"
            labelClassName="font-weight-bold"
            {...form.register("trackingKey")}
            helpText={
              supportsSQL ? (
                <>
                  Unique identifier for this experiment, used to track
                  impressions and analyze results. Will match against the{" "}
                  <code>experiment_id</code> column in your data source.
                </>
              ) : (
                <>
                  Unique identifier for this experiment, used to track
                  impressions and analyze results. Must match the experiment id
                  in your tracking callback.
                </>
              )
            }
          />
          <SelectField
            withRadixThemedPortal
            containerClassName="flex-1"
            label="Assign variation based on attribute"
            labelClassName="font-weight-bold"
            options={hashAttributeOptions}
            sort={false}
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
            helpText={"The globally unique tracking key for the experiment"}
          />
          <FallbackAttributeSelector
            form={form}
            attributeSchema={attributeSchema}
          />
          <HashVersionSelector
            value={form.watch("hashVersion")}
            onChange={(v) => form.setValue("hashVersion", v)}
            project={experiment.project}
          />

          {orgStickyBucketing ? (
            <Checkbox
              mt="4"
              size="lg"
              label="Disable Sticky Bucketing"
              description="Do not persist variation assignments for this experiment (overrides your organization settings)"
              value={!!form.watch("disableStickyBucketing")}
              setValue={(v) => {
                form.setValue("disableStickyBucketing", v === true);
              }}
            />
          ) : null}

          <NamespaceSelector
            form={form}
            featureId={experiment.trackingKey}
            trackingKey={experiment.trackingKey}
            experimentHashAttribute={form.watch("hashAttribute")}
            fallbackAttribute={form.watch("fallbackAttribute")}
          />

          <hr className="my-4" />

          <FeatureVariationsInput
            valueType={"string"}
            coverage={form.watch("coverage")}
            setCoverage={(coverage) => form.setValue("coverage", coverage)}
            setWeight={(i, weight) =>
              form.setValue(`variationWeights.${i}`, weight)
            }
            variations={
              getLatestPhaseVariations(experiment).map((v, i) => {
                return {
                  value: v.key || i + "",
                  name: v.name,
                  weight: form.watch(`variationWeights.${i}`),
                  id: v.id,
                };
              }) || []
            }
            showPreview={false}
            hideVariations={isBandit}
            label="Traffic Percentage & Variation Weights"
            startEditingSplits={true}
          />
        </div>
      </ModalStandard>
    );
  }

  return (
    <MakeChangesFlow
      experiment={experiment}
      form={form}
      defaultValues={defaultValues}
      onSubmit={(scope) => onSubmit(mutate, scope)()}
      close={close}
      canSubmit={canSubmit}
      conditionKey={conditionKey}
      setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
    />
  );
}
