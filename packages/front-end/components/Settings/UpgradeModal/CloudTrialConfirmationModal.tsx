import Modal from "@/components/Modal";

interface Props {
  close: () => void;
  submit: () => void;
  plan: "Pro" | "Enterprise";
  error: string;
}

export default function CloudTrialConfirmationModal({
  plan,
  close,
  submit,
  error,
}: Props) {
  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      size="md"
      header={<h3>Start your free 14-day {plan} Trial</h3>}
      cta="Start Trial"
      error={error}
      autoCloseOnSubmit={false}
      submit={submit}
    >
      Gain access to {plan} features immediately — no credit card required.
      After 14 days, your account will automatically downgrade to our Starter
      version unless you{" "}
      {plan === "Enterprise" ? "contact sales@growthbook.io" : "pay to upgrade"}
      .
    </Modal>
  );
}
