import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import Text from "@/ui/Text";

type EditableVariation = {
  id: string;
  key: string;
  name: string;
  description: string;
};

/** CB-native variation-metadata editor. PUTs the full variation shape (with empty screenshots). */
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
  const [variations, setVariations] = useState<EditableVariation[]>(
    cb.variations.map((v) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      description: v.description ?? "",
    })),
  );

  const update = (
    i: number,
    field: "key" | "name" | "description",
    value: string,
  ) =>
    setVariations((prev) =>
      prev.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)),
    );

  return (
    <ModalStandard
      open
      trackingEventModalType="cb-edit-variations"
      header="Edit Variations"
      close={close}
      cta="Save"
      size="lg"
      submit={async () => {
        await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
          method: "PUT",
          body: JSON.stringify({
            variations: variations.map((v) => ({
              id: v.id,
              key: v.key,
              name: v.name,
              description: v.description,
              screenshots: [],
            })),
          }),
        });
        mutate();
      }}
    >
      {variations.map((v, i) => (
        <Box key={v.id} mb="4">
          <Text weight="medium" as="div" mb="1">
            Variation {i}
          </Text>
          <Field
            label="Name"
            value={v.name}
            onChange={(e) => update(i, "name", e.target.value)}
          />
          <Field
            label="Key"
            value={v.key}
            onChange={(e) => update(i, "key", e.target.value)}
          />
          <Field
            label="Description"
            textarea
            minRows={2}
            value={v.description}
            onChange={(e) => update(i, "description", e.target.value)}
          />
        </Box>
      ))}
    </ModalStandard>
  );
}
