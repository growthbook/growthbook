import router from "next/router";
import Modal from "@/components/Modal";

interface Props {
  close: () => void;
  plan: "Pro" | "Enterprise";
  header?: string;
  isTrial?: boolean;
}

export default function LicenseSuccessModal({
  plan,
  close,
  header,
  isTrial,
}: Props) {
  return (
    <Modal
      trackingEventModalType=""
      open={true}
      cta="Invite Members"
      closeCta={"Skip"}
      close={close}
      size="md"
      header={<h3>{header}</h3>}
      submit={() => {
        router.push("/settings/team?just-subscribed=true");
        return Promise.resolve();
      }}
    >
      <div>
        {(isTrial && (
          <b>Your free 14-day {plan} trial has been activated!</b>
        )) || <b>Your {plan} subscription has been activated!</b>}
      </div>
      <div>Invite team members and start exploring {plan} features.</div>
    </Modal>
  );
}
