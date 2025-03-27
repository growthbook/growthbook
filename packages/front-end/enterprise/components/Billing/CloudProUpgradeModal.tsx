import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useState } from "react";
import Modal from "@/components/Modal";
import { useStripeContext } from "@/hooks/useStripeContext";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

interface Props {
  close: () => void;
  closeParent: () => void;
  numOfCurrentMembers: number;
}

export default function CloudProUpgradeModal({
  close,
  numOfCurrentMembers,
  closeParent,
}: Props) {
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { clientSecret } = useStripeContext();
  const { refreshOrganization } = useUser();
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

      // Add payment method to customer in stripe
      await stripe.confirmSetup({
        elements,
        clientSecret,
        redirect: "if_required",
      });

      // Now that payment is confirmed, create the subscription
      await apiCall("/subscription/start-new-pro", {
        method: "POST",
      });
      refreshOrganization();
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
                ${numOfCurrentMembers * 20} ({numOfCurrentMembers} seat
                {numOfCurrentMembers === 1 ? "" : "s"} x $20/month)
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
