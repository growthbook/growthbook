import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { Flex } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";

/**
 * A variation's ID (its `key`): what tracking records and analysis matches on. Rarely
 * changed, and only to match values already in the warehouse.
 */
export default function EditVariationKeyModal({
  experiment,
  variationIndex,
  analysisOnly,
  close,
  stage,
}: {
  experiment: ExperimentInterfaceStringDates;
  variationIndex: number;
  // With nothing to implement, the key only has to match the data.
  analysisOnly: boolean;
  close: () => void;
  stage: (variations: Variation[]) => void;
}) {
  const variations = getLatestPhaseVariations(experiment).map(
    ({ id, key, name, description, screenshots }) => ({
      id,
      key,
      name,
      description,
      screenshots,
    }),
  );
  const variation = variations[variationIndex];
  const form = useForm({ defaultValues: { key: variation?.key ?? "" } });

  if (!variation) return null;

  return (
    <ModalStandard
      trackingEventModalType="edit-variation-key"
      header="Change variation ID"
      subheader={variation.name || `Variation ${variationIndex}`}
      open={true}
      close={close}
      cta="Apply"
      submit={form.handleSubmit(({ key }) =>
        stage(
          variations.map((v, i) =>
            i === variationIndex ? { ...v, key: key.trim() } : v,
          ),
        ),
      )}
    >
      <Flex direction="column" gap="3">
        {analysisOnly ? (
          <Callout status="info">
            Use the ID your data records for this variation, when it isn&apos;t
            the default.
          </Callout>
        ) : (
          <Callout status="warning">
            The variation ID is how SDKs report this variation and how analysis
            finds it. Change it only to match values already in your data:
            anything tracked under the old ID stops counting toward this
            variation.
          </Callout>
        )}
        <Field
          label="Variation ID"
          required
          containerClassName="mb-0"
          {...form.register("key", {
            validate: (key) =>
              variations.every(
                (v, i) => i === variationIndex || v.key !== key.trim(),
              ) || "Another variation already uses this ID.",
          })}
          error={form.formState.errors.key?.message}
        />
      </Flex>
    </ModalStandard>
  );
}
