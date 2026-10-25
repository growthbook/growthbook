import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getStorableVariations } from "shared/experiments";
import { Flex } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { StopSubmit } from "@/ui/Modal/StopSubmit";
import Callout from "@/ui/Callout";
import VariationLabel from "@/ui/VariationLabel";

export default function EditVariationKeysModal({
  experiment,
  close,
  stage,
}: {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  stage: (variations: Variation[]) => void;
}) {
  const variations = getStorableVariations(experiment);
  const form = useForm({
    defaultValues: { keys: variations.map((v) => v.key) },
  });

  return (
    <ModalStandard
      trackingEventModalType="edit-variation-keys"
      header="Change variation IDs"
      open={true}
      close={close}
      cta="Apply"
      // Checked here, not as a field rule: a failed rule resolves the submit
      // and the modal closes without showing it.
      submit={() => {
        const keys = form.getValues("keys").map((key) => key.trim());
        form.clearErrors();
        const taken = keys.map((key, i) =>
          keys.some((other, j) => j !== i && other === key),
        );
        if (taken.some(Boolean)) {
          taken.forEach((isTaken, i) => {
            if (isTaken) {
              form.setError(`keys.${i}`, {
                message: "Another variation already uses this ID.",
              });
            }
          });
          throw new StopSubmit();
        }
        stage(variations.map((v, i) => ({ ...v, key: keys[i] })));
      }}
    >
      <Flex direction="column" gap="3">
        <Callout status="warning">
          A variation ID is how SDKs report a variation and how analysis finds
          it. Change one only to match values already in your data: anything
          tracked under the old ID stops counting toward that variation.
        </Callout>
        {variations.map((v, i) => (
          <Flex key={v.id} align="center" justify="between" gap="4">
            <VariationLabel number={i} name={v.name || `Variation ${i}`} />
            <Field
              required
              containerClassName="mb-0"
              aria-label={`${v.name || `Variation ${i}`} ID`}
              {...form.register(`keys.${i}`)}
              error={form.formState.errors.keys?.[i]?.message}
            />
          </Flex>
        ))}
      </Flex>
    </ModalStandard>
  );
}
