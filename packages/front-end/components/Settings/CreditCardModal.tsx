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
  numOfCards: number;
}

export default function CreditCardModal({
  onClose,
  refetch,
  numOfCards,
}: Props) {
  const [defaultCard, setDefaultCard] = useState(true);
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
          submitError.message || "Unable to validate card inputs"
        );
      }

      const { setupIntent } = await stripe.confirmSetup({
        elements,
        clientSecret,
        redirect: "if_required",
      });

      if (!setupIntent || !setupIntent.payment_method) {
        throw new Error("Unable to save new card");
      }

      // Optionally, update the user's default payment method
      if (defaultCard) {
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
      trackingEventModalType="add-edit-credit-card"
      cta="Save Card"
      close={() => onClose()}
      header="Add Card"
      submit={async () => await handleSubmit()}
    >
      <>
        <PaymentElement />
        <Flex align="center" justify="end" className="pt-3">
          <Text as="label" className="mb-0 pr-1">
            Set as Default Card
          </Text>
          <Tooltip body="The first card you add is automatically set as the default card">
            <Toggle
              disabled={numOfCards === 0}
              id={"defaultValue"}
              label="Default value"
              value={defaultCard}
              setValue={() => {
                setDefaultCard(!defaultCard);
              }}
            />
          </Tooltip>
        </Flex>
      </>
    </Modal>
  );
}
