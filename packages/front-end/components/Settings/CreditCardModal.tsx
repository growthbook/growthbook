import { useState } from "react";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Flex, Text } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Modal from "../Modal";
import LoadingOverlay from "../LoadingOverlay";
import Toggle from "../Forms/Toggle";

interface Props {
  onClose: () => void;
}

export default function CreditCardModal({ onClose }: Props) {
  const [defaultCard, setDefaultCard] = useState(true);
  const { apiCall } = useAuth();
  const { organization, subscription } = useUser();
  const elements = useElements();
  const stripe = useStripe();

  const customerId = "cus_Rg3aee6F7wi9EH"; //MKTODO: Fix this so the customer is from the subscription

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    try {
      // Trigger form validation and wallet collection
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(
          submitError.message || "Unable to validate card inputs"
        );
      }

      const res: { clientSecret: string } = await apiCall(
        "/subscription/payment-methods/setup-intent",
        {
          method: "POST",
          body: JSON.stringify({ subscription, organization }),
        }
      );

      const { setupIntent } = await stripe.confirmSetup({
        elements,
        clientSecret: res.clientSecret,
        confirmParams: {
          return_url: `${process.env.NEXT_PUBLIC_API_HOST}/settings/billing`,
        },
        redirect: "if_required",
      });

      if (!setupIntent || !setupIntent.payment_method) {
        throw new Error("Unable to save new card");
      }

      // Optionally, make a call to our backend to update the user's default payment method
      if (defaultCard) {
        await apiCall("/subscription/payment-methods/set-default", {
          method: "POST",
          body: JSON.stringify({
            paymentMethodId: setupIntent.payment_method,
            customerId,
          }),
        });
      }
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
        {!stripe || !elements ? (
          <div style={{ minHeight: "300px" }}>
            <LoadingOverlay />
          </div>
        ) : (
          <>
            {/* MKTODO: Still need to style this better for dark mode */}
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
        )}
      </>
    </Modal>
  );
}
