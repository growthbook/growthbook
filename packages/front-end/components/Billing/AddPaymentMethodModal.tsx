import { useState } from "react";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Flex, Text } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useStripeContext } from "@/hooks/useStripeContext";
import Modal from "../Modal";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip/Tooltip";

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
          submitError.message || "Unable to validate payment method inputs"
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
        <Flex align="center" justify="end" className="pt-3">
          <Text as="label" className="mb-0 pr-1">
            Set as Default Payment Method
          </Text>
          <Tooltip
            body="The first payment method you add is automatically set as the default."
            shouldDisplay={numOfMethods === 0}
          >
            <Toggle
              disabled={numOfMethods === 0}
              id={"defaultValue"}
              label="Default value"
              value={defaultPaymentMethod}
              setValue={() => {
                setDefaultPaymentMethod(!defaultPaymentMethod);
              }}
            />
          </Tooltip>
        </Flex>
      </>
    </Modal>
  );
}
