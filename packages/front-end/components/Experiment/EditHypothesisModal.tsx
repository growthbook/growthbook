import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";

interface Props {
  source: string;
  close: () => void;
  experimentId: string;
  hypothesis?: string;
  mutate: () => void;
}

export default function EditHypothesisModal({
  source,
  close,
  experimentId,
  hypothesis,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const form = useForm<{ hypothesis: string }>({
    defaultValues: {
      hypothesis: hypothesis || "",
    },
  });

  return (
    <Modal
      trackingEventModalType="edit-hypothesis-modal"
      trackingEventModalSource={source}
      header={"Edit Hypothesis"}
      size="lg"
      open={true}
      close={close}
      submit={form.handleSubmit(async (data) => {
        await apiCall(`/experiment/${experimentId}`, {
          method: "POST",
          body: JSON.stringify({ hypothesis: data.hypothesis }),
        });
        mutate();
      })}
      cta="Save"
      ctaEnabled={hypothesis !== form.watch("hypothesis")}
    >
      <Field
        label="Hypothesis"
        textarea
        minRows={1}
        placeholder="e.g Making the signup button bigger will increase clicks and ultimately improve revenue"
        {...form.register("hypothesis")}
        name="hypothesis"
      />
    </Modal>
  );
}
