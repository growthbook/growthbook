import { FormProvider, useForm } from "react-hook-form";
import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import FeatureValueField from "@/components/Features/FeatureValueField";
import {
  isUnsetFeatureValue,
  unsetFeatureValueMessage,
} from "@/components/Features/EmptyStringConfirm";

type EditableVariation = {
  id: string;
  key: string;
  name: string;
  description: string;
};

type FormValues = {
  variations: EditableVariation[];
};

type NewVariationValues = Record<string, Record<string, string>>;
type EmptyStringConfirmations = Record<string, Record<string, boolean>>;

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

  const originalIds = new Set(cb.variations.map((v) => v.id));
  const originalById = new Map(cb.variations.map((v) => [v.id, v]));

  const form = useForm<FormValues>({
    defaultValues: {
      variations: cb.variations.map((v) => ({
        id: v.id,
        key: v.key,
        name: v.name,
        description: v.description ?? "",
      })),
    },
  });

  const [newVariationValues, setNewVariationValues] =
    useState<NewVariationValues>({});
  const [showValueErrors, setShowValueErrors] = useState(false);
  const [emptyStringConfirmed, setEmptyStringConfirmed] =
    useState<EmptyStringConfirmations>({});

  const watchedVariations = form.watch("variations") ?? [];
  const addedVariations = watchedVariations
    .map((v, index) => ({ ...v, index }))
    .filter((v) => v.id && !originalIds.has(v.id));
  const showNewValueEditors =
    addedVariations.length > 0 && linkedFeatures.length > 0;

  const valueFor = (lf: LinkedFeatureInfo, variationId: string) =>
    newVariationValues[lf.feature.id]?.[variationId] ?? "";

  const isEmptyConfirmed = (lf: LinkedFeatureInfo, variationId: string) =>
    !!emptyStringConfirmed[lf.feature.id]?.[variationId];

  const setEmptyConfirmed = (
    featureId: string,
    variationId: string,
    confirmed: boolean,
  ) =>
    setEmptyStringConfirmed((prev) => ({
      ...prev,
      [featureId]: { ...(prev[featureId] ?? {}), [variationId]: confirmed },
    }));

  const isMissingValue = (lf: LinkedFeatureInfo, variationId: string) =>
    isUnsetFeatureValue({
      valueType: lf.feature.valueType,
      value: valueFor(lf, variationId),
      emptyStringConfirmed: isEmptyConfirmed(lf, variationId),
    });

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
          const currentIds = new Set(data.variations.map((v) => v.id));
          const addedVariations = data.variations.filter(
            (v) => !originalIds.has(v.id),
          );
          const removeVariationIds = [...originalIds].filter(
            (id) => !currentIds.has(id),
          );
          const updateVariations = data.variations
            .filter((v) => originalIds.has(v.id))
            .flatMap((v) => {
              const prev = originalById.get(v.id);
              if (!prev) return [];
              const patch: {
                id: string;
                name?: string;
                description?: string;
                key?: string;
              } = { id: v.id };
              if (v.name !== prev.name) patch.name = v.name;
              const prevDescription = prev.description ?? "";
              const nextDescription = v.description ?? "";
              if (nextDescription !== prevDescription) {
                patch.description = nextDescription;
              }
              if (v.key !== prev.key) patch.key = v.key;
              return Object.keys(patch).length > 1 ? [patch] : [];
            });

          if (addedVariations.length > 0 && linkedFeatures.length > 0) {
            const missing: string[] = [];
            linkedFeatures.forEach((lf) => {
              addedVariations.forEach((v) => {
                if (!isMissingValue(lf, v.id)) return;
                missing.push(
                  `${lf.feature.id} → ${v.name || v.key || "new variation"}`,
                );
              });
            });
            if (missing.length > 0) {
              setShowValueErrors(true);
              throw new Error(
                "Set a Feature Flag value for every new variation before saving",
              );
            }
          }

          const addVariations = addedVariations.map((v) => ({
            id: v.id,
            key: v.key || "",
            name: v.name,
            description: v.description,
            screenshots: [],
            ...(linkedFeatures.length > 0
              ? {
                  values: Object.fromEntries(
                    linkedFeatures.map((lf) => [
                      lf.feature.id,
                      valueFor(lf, v.id),
                    ]),
                  ),
                }
              : {}),
          }));

          if (
            addVariations.length === 0 &&
            removeVariationIds.length === 0 &&
            updateVariations.length === 0
          ) {
            mutate();
            return;
          }

          await apiCall(`/api/v1/contextual-bandits/${cb.id}/variations`, {
            method: "POST",
            body: JSON.stringify({
              addVariations,
              removeVariationIds,
              updateVariations,
            }),
          });
          mutate();
        })}
      >
        <FeatureVariationsInput
          label={null}
          hideSplits
          hideCoverage
          showDescriptions
          showPreview={false}
          startEditingIndexes
          // Splits are hidden and weights are reconciled server-side, so the
          // weight is a placeholder the input requires but never shows. The
          // no-op setWeight is needed because FeatureVariationsInput only
          // renders its Add-variation footer when setWeight is passed.
          setWeight={() => {}}
          variations={watchedVariations.map((v) => ({
            value: v.key || "",
            name: v.name,
            description: v.description,
            screenshots: [],
            weight: 0,
            id: v.id,
          }))}
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
                variation(s) you added. A value is required for each one; you
                can change it later on the Feature Flag.
              </Text>
            </Box>
            {linkedFeatures.map((lf) => (
              <Box key={lf.feature.id} mb="3">
                <Heading as="h4" size="sm" mb="1">
                  {lf.feature.id}
                </Heading>
                {addedVariations.map((v) => (
                  <Box key={`${lf.feature.id}:${v.id}`} mb="2">
                    {showValueErrors && isMissingValue(lf, v.id) && (
                      <HelperText status="error">
                        {unsetFeatureValueMessage(lf.feature.valueType)}
                      </HelperText>
                    )}
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
                      confirmEmptyString
                      emptyStringConfirmed={isEmptyConfirmed(lf, v.id)}
                      setEmptyStringConfirmed={(checked) =>
                        setEmptyConfirmed(lf.feature.id, v.id, checked)
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
