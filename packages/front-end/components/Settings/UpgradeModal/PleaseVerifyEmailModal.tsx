import Modal from "@/components/Modal";

interface Props {
  close: () => void;
  plan: "Pro" | "Enterprise";
  isTrial: boolean;
}

export default function PleaseVerifyEmailModal({
  plan,
  close,
  isTrial,
}: Props) {
  return (
    <Modal
      open={true}
      cta="Close"
      includeCloseCta={false}
      close={close}
      size="md"
      header={<h3 className="mb-0">Verify your email address</h3>}
      submit={close}
      fullWidthSubmit={true}
      tertiaryCTA={
        <div className="text-center w-100 my-3">
          Don&apos;t see an email? Check your spam folder or{" "}
          <a href="mailto: support@growthbook.io">contact support</a>.
        </div>
      }
    >
      <div className="my-2">
        <b>Thanks for signing up!</b>
      </div>
      <div>
        Check your email for a verification link. Clicking the link will
        activate your{" "}
        {isTrial ? `free 14-day ${plan} plan trial` : `${plan} subscription`}.
      </div>
    </Modal>
  );
}
