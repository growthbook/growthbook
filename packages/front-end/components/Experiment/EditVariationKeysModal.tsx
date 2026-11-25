import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getStorableVariations } from "shared/experiments";
import { Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
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
  const { t } = useLingui();
  const variations = getStorableVariations(experiment);
  const form = useForm({
    defaultValues: { keys: variations.map((v) => v.key) },
  });

  return (
    <ModalStandard
      trackingEventModalType="edit-variation-keys"
      header={t`Change variation keys`}
      open={true}
      close={close}
      cta={t`Apply`}
      submit={validatedSubmit(form, ({ keys }) =>
        stage(variations.map((v, i) => ({ ...v, key: keys[i].trim() }))),
      )}
    >
      <Flex direction="column" gap="3">
        <Callout status="warning">
          <Trans>
            A variation key is how SDKs report a variation and how analysis
            finds it. Change one only to match values already in your data:
            anything tracked under the old key stops counting toward that
            variation.
          </Trans>
        </Callout>
        {variations.map((v, i) => {
          const variationName = v.name || t`Variation ${i}`;
          return (
            <Flex key={v.id} align="center" justify="between" gap="4">
              <VariationLabel number={i} name={variationName} />
              <Field
                required
                containerClassName="mb-0"
                aria-label={t`${variationName} key`}
                {...form.register(`keys.${i}`, {
                  validate: (key) =>
                    form
                      .getValues("keys")
                      .every(
                        (other, j) => j === i || other.trim() !== key.trim(),
                      ) || t`Another variation already uses this key.`,
                })}
                error={form.formState.errors.keys?.[i]?.message}
              />
            </Flex>
          );
        })}
      </Flex>
    </ModalStandard>
  );
}
