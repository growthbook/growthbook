import { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  variationIndex: number;
  close: () => void;
  mutate: () => void;
  source?: string;
}

const EditVariationMetadataModal: FC<Props> = ({
  experiment,
  variationIndex,
  close,
  mutate,
  source,
}) => {
  const { apiCall } = useAuth();
  const variation = experiment.variations[variationIndex];

  const form = useForm({
    defaultValues: {
      name: variation?.name ?? "",
      description: variation?.description ?? "",
    },
  });

  if (!variation) return null;

  return (
    <ModalStandard
      trackingEventModalType="edit-variation-metadata"
      trackingEventModalSource={source}
      header="Edit Variation"
      subheader={
        <>
          Want to edit values? Navigate to{" "}
          <Text size="large" weight="semibold">
            {" "}
            Implementation {">"} Edit
          </Text>
        </>
      }
      open={true}
      close={close}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const variations = experiment.variations.map((v, i) =>
          i === variationIndex
            ? {
                ...v,
                name: value.name,
                description: value.description,
              }
            : v,
        );

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ variations }),
        });
        mutate();
        track("edited-variation-metadata");
      })}
      cta="Save"
    >
      <Flex direction="row" gap="3" align="start">
        <Box style={{ paddingTop: 28 }}>
          <Box
            className={`variation with-variation-label variation${variationIndex}`}
          >
            <span className="label">{variationIndex}</span>
          </Box>
        </Box>
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
        </Flex>
      </Flex>
    </ModalStandard>
  );
};

export default EditVariationMetadataModal;
