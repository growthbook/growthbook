import { Separator } from "@radix-ui/themes";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import Modal from "@/components/Modal";

interface Props {
  close: () => void;
  seatsInUse: number;
}

export default function StartCloudProModal({ close, seatsInUse }) {
  return (
    <Modal
      trackingEventModalType="start-cloud-pro"
      header="Upgrade to Pro"
      open={true}
      close={close}
      submit={() => console.log("submitted")}
    >
      <p>
        Pro accounts cost <strong>$20/month per user.</strong> After upgrading,
        an amount of
        <strong>
          {" $"}
          {20 * seatsInUse} {`(${seatsInUse} seats x $20/month)`}
        </strong>{" "}
        will be added to this month&apos;s invoice and your credit card will be
        charged immediately.
      </p>
      <Separator size="4" />
      <PaymentElement />
    </Modal>
  );
}
