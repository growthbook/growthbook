import { useState } from "react";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Flex } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { useStripeContext } from "@/hooks/useStripeContext";

interface Props {
  onClose: () => void;
  refetch: () => void;
  numOfMethods: number;
}

export default function AddPaymentMethodModal({
  onClose,
  refetch,
  numOfMethods,
}: Props) {
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState(true);
  const { clientSecret } = useStripeContext();
  const { apiCall } = useAuth();
  const elements = useElements();
  const stripe = useStripe();

  const handleSubmit = async () => {
    if (!stripe || !elements || !clientSecret) return;
    try {
      // Trigger form validation and wallet collection
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(
          submitError.message || "Unable to validate payment method inputs",
        );
      }

      const { setupIntent } = await stripe.confirmSetup({
        elements,
        clientSecret,
        redirect: "if_required",
      });

      if (!setupIntent || !setupIntent.payment_method) {
        throw new Error("Unable to save new payment method");
      }

      // Optionally, update the user's default payment method
      if (defaultPaymentMethod) {
        await apiCall("/subscription/payment-methods/set-default", {
          method: "POST",
          body: JSON.stringify({
            paymentMethodId: setupIntent.payment_method,
          }),
        });
      }
      refetch();
    } catch (e) {
      throw new Error(e.message);
    }
  };

  return (
    <Modal
      open={true}
      trackingEventModalType="add-edit-payment-method"
      cta="Save Payment Method"
      close={() => onClose()}
      header="Add Payment Method"
      submit={async () => await handleSubmit()}
    >
      <>
        <PaymentElement />
        {numOfMethods > 0 ? (
          <Flex align="center" justify="end" className="pt-3">
            <Checkbox
              label="Set as Default Payment Method"
              value={defaultPaymentMethod}
              setValue={() => {
                setDefaultPaymentMethod(!defaultPaymentMethod);
              }}
            />
          </Flex>
        ) : null}
      </>
    </Modal>
  );
}
