import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getEqualWeights } from "shared/experiments";
import { PiPlusCircleFill } from "react-icons/pi";
import { distributeWeights } from "@/services/utils";
import { generateVariationId } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

const AddVariationModal: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
  source?: string;
}> = ({ experiment, mutate, close, source }) => {
  const { apiCall } = useAuth();
  const [showDescription, setShowDescription] = useState(false);

  const form = useForm({
    defaultValues: {
      name: `Variation ${experiment.variations.length}`,
      description: "",
    },
  });

  return (
    <ModalStandard
      open
      header="Add Variation"
      subheader="Variation details be reflected on all linked Feature Flag rules"
      cta="Add"
      size="lg"
      close={close}
      trackingEventModalType="add-variation"
      trackingEventModalSource={source}
      submit={form.handleSubmit(async (value) => {
        const name = value.name.trim();
        if (!name) {
          throw new Error("Variation name is required");
        }

        const lastPhase = experiment.phases[experiment.phases.length - 1];
        const currentWeights =
          lastPhase?.variationWeights ??
          getEqualWeights(experiment.variations.length, 4);

        // Matches the "Add variation" behavior in the Edit Variations modal:
        // when the existing splits are equal, redistribute traffic evenly across
        // all variations; when they're custom/uneven, add the new variation at 0%
        // and leave the existing weights untouched.
        const isEqualWeights =
          currentWeights.length > 0 &&
          currentWeights.every((w) => Math.abs(w - currentWeights[0]) < 0.0001);

        const newVariations = [
          ...experiment.variations,
          {
            id: generateVariationId(),
            name,
            description: value.description.trim(),
            key: `${experiment.variations.length}`,
            screenshots: [],
          },
        ];

        const variationWeights = isEqualWeights
          ? getEqualWeights(newVariations.length, 4)
          : distributeWeights([...currentWeights, 0], true);

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({
            variations: newVariations,
            variationWeights,
          }),
        });
        mutate();
        track("add-variation", { source });
      })}
    >
      <Callout status="warning" mb="4">
        Values must be defined for each implementation prior to starting
        experiment.
      </Callout>
      <Flex direction="row" gap="3" align="start">
        <Box pt="6">
          <Box
            className={`variation with-variation-label variation${experiment.variations.length}`}
          >
            <span className="label">{experiment.variations.length}</span>
          </Box>
        </Box>
        <Flex direction="column" gap="4" style={{ flex: 1, minWidth: 0 }}>
          <Field
            label="Name"
            required
            containerClassName="mb-0"
            {...form.register("name")}
          />
          {showDescription ? (
            <Field
              label="Description"
              textarea
              minRows={2}
              {...form.register("description")}
            />
          ) : (
            <Link onClick={() => setShowDescription(true)}>
              <Flex align="center" gap="1">
                <PiPlusCircleFill size={15} />
                <Text weight="semibold">Add description</Text>
              </Flex>
            </Link>
          )}
        </Flex>
      </Flex>
    </ModalStandard>
  );
};

export default AddVariationModal;
