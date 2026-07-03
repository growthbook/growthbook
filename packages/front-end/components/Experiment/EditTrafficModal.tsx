import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAttributeSchema } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import { distributeWeights } from "@/services/utils";
import Checkbox from "@/ui/Checkbox";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import track from "@/services/track";
import HashVersionSelector from "./HashVersionSelector";
import MakeChangesFlow from "./MakeChangesFlow";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
  // Auto-focus this variation's Name field when the modal opens.
  focusVariationId?: string | null;
  // Append a new variation on open and focus its Name field.
  addVariationOnOpen?: boolean;
}

export default function EditTrafficModal({
  close,
  experiment,
  mutate,
  safeToEdit,
  focusVariationId,
  addVariationOnOpen,
}: Props) {
  const simpleExperimentFlow = useFeatureIsOn("simple-experiment-flow");

  if (safeToEdit) {
    return simpleExperimentFlow ? (
      <EditTrafficForm
        close={close}
        experiment={experiment}
        mutate={mutate}
        focusVariationId={focusVariationId}
        addVariationOnOpen={addVariationOnOpen}
      />
    ) : (
      <LegacyEditTrafficForm
        close={close}
        experiment={experiment}
        mutate={mutate}
      />
    );
  }

  return <MakeChanges close={close} experiment={experiment} mutate={mutate} />;
}

function EditTrafficForm({
  close,
  experiment,
  mutate,
  focusVariationId,
  addVariationOnOpen,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  focusVariationId?: string | null;
  addVariationOnOpen?: boolean;
}) {
  const { apiCall } = useAuth();
  const isBandit = experiment.type === "multi-armed-bandit";

  const latestPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const form = useForm<
    ExperimentInterfaceStringDates & {
      variationWeights: number[];
      coverage: number;
    }
  >({
    defaultValues: {
      variations: getLatestPhaseVariations(experiment).map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        description: v.description,
        screenshots: v.screenshots,
      })),
      variationWeights:
        latestPhase?.variationWeights ??
        getEqualWeights(experiment.variations.length, 4),
      coverage: latestPhase?.coverage ?? 1,
    },
  });

  const submit = form.handleSubmit(async (value) => {
    const originalVariationCount = getLatestPhaseVariations(experiment).length;
    const data = { ...value };
    data.variations = [...value.variations].map((variation, i) => {
      if (!variation.key) variation.key = i + "";
      return variation;
    });

    // fix some common bugs
    if (!isBandit) {
      const newWeights = [
        ...data.variations.map((_, i) =>
          Math.min(
            Math.max(
              data.variationWeights?.[i] ?? 1 / (data.variations?.length || 2),
              0,
            ),
            1,
          ),
        ),
      ];
      data.variationWeights = distributeWeights(newWeights, true);
    } else {
      const latestVariationWeights = latestPhase?.variationWeights ?? [];
      if (
        data.variations.length !== data.variationWeights.length ||
        data.variations.length !== latestVariationWeights.length
      ) {
        // only recompute weights if original weights are the wrong size
        data.variationWeights = getEqualWeights(data.variations.length || 2, 4);
      } else {
        data.variationWeights = [...latestVariationWeights];
      }
    }

    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    mutate();
    track("edited-traffic");

    const numVariationsAdded = data.variations.length - originalVariationCount;
    if (numVariationsAdded > 0) {
      track("Added Variations", {
        source: "edit-traffic-modal",
        numVariationsAdded,
        totalVariations: data.variations.length,
      });
    }
  });

  return (
    <ModalStandard
      trackingEventModalType="edit-traffic-modal"
      open={true}
      close={close}
      header="Edit Traffic & Variations"
      submit={submit}
      size="lg"
    >
      <div className="pt-2">
        <FeatureVariationsInput
          label={null}
          valueAsId={isBandit}
          hideSplits={isBandit}
          coverage={form.watch("coverage")}
          setCoverage={(coverage) => form.setValue("coverage", coverage)}
          setWeight={(i, weight) =>
            form.setValue(`variationWeights.${i}`, weight)
          }
          variations={
            form.watch("variations")?.map((v, i) => ({
              value: v.key || "",
              name: v.name,
              description: v.description,
              screenshots: v.screenshots,
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            })) ?? []
          }
          setVariations={(v) => {
            form.setValue(
              "variations",
              v.map((data) => {
                const { value, ...newData } = data;
                return {
                  name: "",
                  description: "",
                  screenshots: [],
                  ...newData,
                  key: value,
                };
              }),
            );
            form.setValue(
              `variationWeights`,
              v.map((v) => v.weight),
            );
          }}
          showPreview
          showDescriptions
          autoFocusVariationId={focusVariationId}
          autoAddVariationOnMount={addVariationOnOpen}
        />
      </div>
    </ModalStandard>
  );
}

function LegacyEditTrafficForm({
  close,
  experiment,
  mutate,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}) {
  const { form, canSubmit, onSubmit } = useExperimentTargetingForm(experiment);

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

  return (
    <ModalStandard
      trackingEventModalType="edit-traffic-modal"
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
                Unique identifier for this experiment, used to track impressions
                and analyze results. Will match against the{" "}
                <code>experiment_id</code> column in your data source.
              </>
            ) : (
              <>
                Unique identifier for this experiment, used to track impressions
                and analyze results. Must match the experiment id in your
                tracking callback.
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

function MakeChanges({
  close,
  experiment,
  mutate,
}: {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}) {
  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment);

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
