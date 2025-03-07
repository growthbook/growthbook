import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useState } from "react";
import Modal from "@/components/Modal";
import { useStripeContext } from "@/hooks/useStripeContext";
import { useAuth } from "@/services/auth";

interface Props {
  close: () => void;
  closeParent: () => void;
  seatsInUse: number;
  subscriptionId: string;
}

export default function CloudProUpgradeModal({
  close,
  seatsInUse,
  closeParent,
  subscriptionId,
}: Props) {
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { clientSecret } = useStripeContext();
  const { apiCall } = useAuth();
  const elements = useElements();
  const stripe = useStripe();

  const handleSubmit = async () => {
    if (!stripe || !elements || !clientSecret) return;
    setLoading(true);
    try {
      // Validate inputs
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(
          submitError.message || "Unable to validate payment method inputs"
        );
      }

      // Add the payment method to the customer & finalize subscription
      await stripe.confirmPayment({
        elements,
        clientSecret,
        redirect: "if_required",
      });

      // Should we make a call to set this as the user's default payment?

      // add stripeSubscription to the license object
      await apiCall("/subscription/new-inline-pro/success", {
        method: "POST",
        body: JSON.stringify({
          subscriptionId,
        }),
      });
      setLoading(false);
      setSuccess(true);
    } catch (e) {
      setLoading(false);
      throw new Error(e.message);
    }
  };

  return (
    <Modal
      trackingEventModalType="upgrade-to-pro"
      trackingEventModalSource="upgrade-modal"
      open={true}
      close={() => {
        if (success) {
          closeParent();
        } else {
          close();
        }
      }}
      autoCloseOnSubmit={false}
      loading={loading}
      closeCta={success ? "Close" : "Cancel"}
      header={success ? "🎉 Welcome to GrowthBook Pro!" : "Upgrade to Pro"}
      submit={success ? undefined : async () => await handleSubmit()}
      cta={success ? "Close" : "Upgrade To Pro"}
    >
      <div>
        {success ? (
          <>
            <p>
              You now have access to all Pro Features, like advanced
              user-permissions, Sequential testing, Bandit experiments, CUPED,
              and much more!
            </p>
          </>
        ) : (
          <>
            <p>
              Pro accounts cost <strong>$20/month per user</strong>. After
              upgrading, an amount of{" "}
              <strong>
                ${seatsInUse * 20} ({seatsInUse} seat
                {seatsInUse === 1 ? "" : "s"} x $20/month)
              </strong>{" "}
              will be added this month&apos;s invoice and your credit card will
              be charged immediately.
            </p>
            <PaymentElement />
          </>
        )}
      </div>
    </Modal>
  );
}
