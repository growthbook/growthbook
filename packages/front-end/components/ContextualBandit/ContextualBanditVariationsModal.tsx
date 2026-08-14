import { FormProvider, useForm } from "react-hook-form";
import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import FeatureValueField from "@/components/Features/FeatureValueField";

type EditableVariation = {
  id: string;
  key: string;
  name: string;
  description: string;
};

type FormValues = {
  variations: EditableVariation[];
  variationWeights: number[];
};

type NewVariationValues = Record<string, Record<string, string>>;

/**
 */
export default function ContextualBanditVariationsModal({
  cb,
  linkedFeatures = [],
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  linkedFeatures?: LinkedFeatureInfo[];
  mutate: () => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();

  const exploiting = cb.stage === "exploit" || cb.stage === "paused";

  const originalIds = new Set(cb.variations.map((v) => v.id));

  const initialVariationCount = cb.variations.length;
  const form = useForm<FormValues>({
    defaultValues: {
      variations: cb.variations.map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        description: v.description ?? "",
      })),
      variationWeights: cb.variations.map(
        (v) =>
          cb.variationWeights?.find((w) => w.variationId === v.id)?.weight ??
          1 / (initialVariationCount || 2),
      ),
    },
  });

  const [newVariationValues, setNewVariationValues] =
    useState<NewVariationValues>({});

  const watchedVariations = form.watch("variations") ?? [];
  const addedVariations = watchedVariations
    .map((v, index) => ({ ...v, index }))
    .filter((v) => v.id && !originalIds.has(v.id));
  const showNewValueEditors =
    addedVariations.length > 0 && linkedFeatures.length > 0;

  const defaultValueFor = (lf: LinkedFeatureInfo) =>
    lf.values?.[0]?.value ?? lf.feature.defaultValue;

  const valueFor = (lf: LinkedFeatureInfo, variationId: string) =>
    newVariationValues[lf.feature.id]?.[variationId] ?? defaultValueFor(lf);

  const setValueFor = (featureId: string, variationId: string, value: string) =>
    setNewVariationValues((prev) => ({
      ...prev,
      [featureId]: { ...(prev[featureId] ?? {}), [variationId]: value },
    }));

  return (
    <FormProvider {...form}>
      <ModalStandard
        open
        trackingEventModalType="cb-edit-variations"
        header="Edit Variations"
        close={close}
        cta="Save"
        size="lg"
        submit={form.handleSubmit(async (data) => {
          const variations = data.variations.map((v, i) => ({
            id: v.id,
            key: v.key || `${i}`,
            name: v.name,
            description: v.description,
            screenshots: [],
          }));

          const addedIds = variations
            .map((v) => v.id)
            .filter((id) => !originalIds.has(id));
          const body: {
            variations: typeof variations;
            newVariationValues?: NewVariationValues;
          } = { variations };
          if (addedIds.length > 0 && linkedFeatures.length > 0) {
            const values: NewVariationValues = {};
            linkedFeatures.forEach((lf) => {
              addedIds.forEach((variationId) => {
                values[lf.feature.id] = values[lf.feature.id] ?? {};
                values[lf.feature.id][variationId] = valueFor(lf, variationId);
              });
            });
            body.newVariationValues = values;
          }

          await apiCall(`/api/v1/contextual-bandits/${cb.id}/variations`, {
            method: "POST",
            body: JSON.stringify(body),
          });
          // A rule change left in a draft (approval, conflict, permissions)
          // is not a failed save — the detail page reports what's waiting.
          mutate();
        })}
      >
        <Callout status="info" size="sm" mb="4">
          {exploiting
            ? "This Bandit is exploiting. Removing a variation redistributes its weight proportionally across the others; a new variation starts with an even share and the Bandit re-learns its weight from there."
            : "Traffic is split evenly across variations while the Bandit explores. Adding or removing a variation re-balances that even split."}
          {linkedFeatures.length > 0 &&
            (showNewValueEditors
              ? " Linked Feature Flags are updated automatically: removed variations are dropped from their rules, and new variations serve the values you set below. Where a Feature Flag requires approval, the change is saved as a draft instead and the new variation receives no traffic until that revision is published."
              : " Linked Feature Flags are updated automatically: removed variations are dropped from their rules. Where a Feature Flag requires approval, the change is saved as a draft for review instead.")}
        </Callout>
        <FeatureVariationsInput
          label={null}
          valueAsId
          hideSplits
          hideCoverage
          showDescriptions
          showPreview={false}
          setWeight={(i, weight) => {
            form.setValue(`variationWeights.${i}`, weight);
          }}
          variations={
            watchedVariations.map((v, i) => ({
              value: v.key || "",
              name: v.name,
              description: v.description,
              screenshots: [],
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            })) ?? []
          }
          setVariations={(v) => {
            form.setValue(
              "variations",
              v.map((data) => ({
                id: data.id || "",
                key: data.value,
                name: data.name ?? "",
                description: data.description ?? "",
              })),
            );
            form.setValue(
              "variationWeights",
              v.map((data) => data.weight),
            );
          }}
        />

        {showNewValueEditors && (
          <Box mt="4">
            <Box mb="3">
              <Heading as="h3" size="sm" mb="1">
                Feature Flag Values for New Variations
              </Heading>
              <Text as="div" size="sm" color="text-low">
                Set the value each linked Feature Flag serves for the
                variation(s) you added. Defaults to the control value; you can
                change it later on the Feature Flag.
              </Text>
            </Box>
            {linkedFeatures.map((lf) => (
              <Box key={lf.feature.id} mb="3">
                <Heading as="h4" size="sm" mb="1">
                  {lf.feature.id}
                </Heading>
                {addedVariations.map((v) => (
                  <Box key={`${lf.feature.id}:${v.id}`} mb="2">
                    <FeatureValueField
                      id={`cb-newval-${lf.feature.id}-${v.id}`}
                      label={
                        <VariationLabel
                          number={v.index}
                          name={v.name || v.key || "New variation"}
                          size="lg"
                          disableTooltip
                        />
                      }
                      valueType={lf.feature.valueType}
                      feature={lf.feature}
                      value={valueFor(lf, v.id)}
                      setValue={(value) =>
                        setValueFor(lf.feature.id, v.id, value)
                      }
                    />
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        )}
      </ModalStandard>
    </FormProvider>
  );
}
