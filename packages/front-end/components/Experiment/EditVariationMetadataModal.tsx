import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { getStorableVariations } from "shared/experiments";
import { Box, Flex } from "@radix-ui/themes";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import FieldAlignedVariationNumber, {
  VARIATION_NUMBER_WIDTH,
} from "@/components/Experiment/FieldAlignedVariationNumber";
import VariationScreenshotManager from "@/components/Experiment/VariationScreenshotManager";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  variationIndex: number;
  close: () => void;
  // Hands the edited variations to the page, which saves them with the rest.
  stage: (variations: Variation[]) => void;
  source?: string;
}

const EditVariationMetadataModal: FC<Props> = ({
  experiment,
  variationIndex,
  close,
  stage,
  source,
}) => {
  const variations = getStorableVariations(experiment);
  const variation = variations[variationIndex];

  const form = useForm({
    defaultValues: {
      name: variation?.name ?? "",
      description: variation?.description ?? "",
    },
  });
  const [screenshots, setScreenshots] = useState(variation?.screenshots ?? []);
  // Apply stages only finished uploads, so it waits for the rest.
  const [uploading, setUploading] = useState(0);

  if (!variation) return null;

  return (
    <ModalStandard
      trackingEventModalType="edit-variation-metadata"
      trackingEventModalSource={source}
      header="Edit Variation"
      open={true}
      close={close}
      size="lg"
      submit={validatedSubmit(form, async (value) => {
        const updatedVariations = variations.map((v, i) =>
          i === variationIndex
            ? {
                ...v,
                name: value.name,
                description: value.description,
                screenshots,
              }
            : v,
        );

        stage(updatedVariations);
        track("edited-variation-metadata");
      })}
      cta={uploading > 0 ? "Uploading…" : "Apply"}
      ctaEnabled={uploading === 0}
    >
      <Flex direction="row" gap="3" align="start">
        <FieldAlignedVariationNumber number={variationIndex} />
        <Flex direction="column" gap="3" style={{ flex: 1, minWidth: 0 }}>
          <Field
            label="Name"
            required
            containerClassName="mb-0"
            {...form.register("name")}
          />
          <Field
            label="Description"
            textarea
            containerClassName="mb-0"
            {...form.register("description")}
          />
          <VariationScreenshotManager
            experiment={experiment}
            variationIndex={variationIndex}
            screenshots={screenshots}
            setScreenshots={setScreenshots}
            setUploading={setUploading}
          />
        </Flex>
        {/* Balances the badge's gutter so the fields stay centred. */}
        <Box width={VARIATION_NUMBER_WIDTH} flexShrink="0" />
      </Flex>
    </ModalStandard>
  );
};

export default EditVariationMetadataModal;
