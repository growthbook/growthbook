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
}

export default function CloudProUpgradeModal({ close, closeParent }: Props) {
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
              The cost is <strong>$20 per seat per month</strong>. You will be
              charged a pro-rated amount immediately for the remainder of the
              current month and it will renew automatically on the 1st of each
              subsequent month. Cancel anytime.
            </p>
            <PaymentElement />
          </>
        )}
      </div>
    </Modal>
  );
}
