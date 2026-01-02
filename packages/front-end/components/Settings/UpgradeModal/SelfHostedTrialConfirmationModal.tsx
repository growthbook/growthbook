import { useForm } from "react-hook-form";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";

interface Props {
  close: () => void;
  submit: (name?: string, email?: string) => void;
  plan: "Pro" | "Enterprise";
  error: string;
}

export default function SelfHostedTrialConfirmationModal({
  plan,
  close,
  submit,
  error,
}: Props) {
  const { name, email } = useUser();
  const form = useForm({
    defaultValues: {
      name,
      email,
    },
  });
  return (
    <Modal
      trackingEventModalType=""
      open={true}
      includeCloseCta={false}
      close={close}
      size="md"
      header={<h3>14-day {plan} Trial for Self-Hosted Accounts</h3>}
      autoCloseOnSubmit={false}
      error={error}
      cta={`Start 14-day ${plan} Trial`}
      submit={form.handleSubmit(async (data) => {
        await submit(data.name, data.email);
      })}
    >
      <div>
        No credit card required. Simply verify your account via email to start
        your free 14-day {plan} plan trial.
      </div>
      <Field required={true} label="Name" {...form.register("name")} />
      <Field
        required={true}
        label="Email address"
        {...form.register("email")}
      />
    </Modal>
  );
}
