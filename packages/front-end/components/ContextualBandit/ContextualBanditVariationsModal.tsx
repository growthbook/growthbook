import { FormProvider, useForm } from "react-hook-form";
import { ApiContextualBanditInterface } from "shared/validators";
import { getEqualWeights } from "shared/experiments";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";

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

/**
 * CB-native variation-metadata editor built on the shared `FeatureVariationsInput`
 * (mirrors the experiment bandit `EditVariationsForm`). Splits/weights are hidden
 * since the bandit algorithm manages them; only names/keys/descriptions and
 * adding/removing variations are editable here. Coverage lives in the Traffic &
 * Targeting modal.
 */
export default function ContextualBanditVariationsModal({
  cb,
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();

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

          const countChanged = variations.length !== initialVariationCount;
          const body: {
            variations: typeof variations;
            variationWeights?: { variationId: string; weight: number }[];
          } = { variations };
          if (countChanged) {
            const equalWeights = getEqualWeights(variations.length || 2, 4);
            body.variationWeights = variations.map((v, i) => ({
              variationId: v.id,
              weight: equalWeights[i] ?? 1 / (variations.length || 2),
            }));
          }

          await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          mutate();
        })}
      >
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
            form.watch("variations")?.map((v, i) => ({
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
      </ModalStandard>
    </FormProvider>
  );
}
