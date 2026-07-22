import { FormProvider, useForm } from "react-hook-form";
import { ApiContextualBanditInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";

type EditableVariation = {
  id: string;
  key: string;
  name: string;
  description: string;
};

type FormValues = {
  variations: EditableVariation[];
  // Local-only bookkeeping so FeatureVariationsInput's add/remove behaves; NOT
  // sent to the server — weight reconciliation is owned by the backend.
  variationWeights: number[];
};

/**
 * CB-native variation editor built on the shared `FeatureVariationsInput`.
 * Splits/weights are hidden and never sent — the backend owns weight
 * reconciliation (POST /contextual-bandits/:id/variations). While the bandit is
 * exploiting it holds learned per-leaf weights and add/remove isn't supported
 * yet (pending the redistribution formula), so exploit edits are restricted to
 * variation metadata only.
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

  // Add/remove is only offered while the arm split is still uniform (draft or
  // explore). In exploit/paused the bandit has learned per-leaf weights and
  // redistribution on arm changes isn't available yet, so we allow metadata
  // edits only.
  const metadataOnly = cb.stage === "exploit" || cb.stage === "paused";

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

          // Send only the variation list; the server reconciles weights and
          // bumps banditVersion.
          await apiCall(`/api/v1/contextual-bandits/${cb.id}/variations`, {
            method: "POST",
            body: JSON.stringify({ variations }),
          });
          mutate();
        })}
      >
        <Callout status="info" size="sm" mb="4">
          {metadataOnly
            ? "This bandit is exploiting, so you can edit variation names and keys here. Adding or removing variations isn't available while it's exploiting."
            : "Traffic is split evenly across variations while the bandit explores. Adding or removing a variation re-balances that even split."}
        </Callout>
        <FeatureVariationsInput
          label={null}
          valueAsId
          hideSplits
          hideCoverage
          showDescriptions
          showPreview={false}
          onlySafeToEditVariationMetadata={metadataOnly}
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
