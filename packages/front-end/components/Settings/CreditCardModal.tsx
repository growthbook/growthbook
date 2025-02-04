import { useState } from "react";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Flex, Text } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import { useStripeContext } from "../Billing/StripeProviderWrapper";
import Toggle from "../Forms/Toggle";

interface Props {
  onClose: () => void;
  refetch: () => void;
}

export default function CreditCardModal({ onClose, refetch }: Props) {
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
        confirmParams: {
          return_url: `${process.env.NEXT_PUBLIC_API_HOST}/settings/billing`,
        },
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
          <Toggle
            id={"defaultValue"}
            label="Default value"
            value={defaultCard}
            setValue={() => {
              setDefaultCard(!defaultCard);
            }}
          />
        </Flex>
      </>
    </Modal>
  );
}
