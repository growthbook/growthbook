import { useState } from "react";
import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import Modal from "../Modal";

interface Props {
  onClose: () => void;
  paymentProviderId?: string; // Rethink this - build this in a way where this is always defined
}

export default function CreditCardModal({
  onClose,
  paymentProviderId = "",
}: Props) {
  const elements = useElements();
  const [error, setError] = useState<string | undefined>(undefined);
  const stripe = useStripe();

  console.log("elements", elements);

  const handleSubmit = async () => {
    setError(undefined);

    if (!stripe || !elements) {
      // stripe hasn't loaded yet
      // throw errors
      return;
    }

    try {
      const result = await stripe.createPaymentMethod({ elements });

      console.log("result", result);
      if (result.error || !result.paymentMethod?.id) {
        console.error(result.error);
        setError(result?.error?.message || "Unable to add a new card.");
        return;
      }

      console.log("paymentProviderId", paymentProviderId);

      // Now, we need to actually update the user's card
      const updateCustomerResponse = await fetch(
        `https://api.stripe.com/v1/payment_methods/${result.paymentMethod.id}/attach`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_STRIPE_TEST_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded", // Set the correct content type
          },
          body: new URLSearchParams({
            customer: paymentProviderId, // Make sure paymentProviderId is a valid customer ID
          }),
        }
      );
      console.log("rawResponse", updateCustomerResponse);

      if (!updateCustomerResponse.ok) {
        setError("Unable to add a new card.");
      }
      const updatedCustomer = await updateCustomerResponse.json();
      console.log("formattedResponse", updatedCustomer);
      window.location.reload();
    } catch (e) {
      console.log(e);
    }
  };
  return (
    <Modal
      open={true}
      trackingEventModalType="add-edit-credit-card"
      cta="Save Card"
      close={() => onClose()}
      header="Add Card"
      submit={async () => handleSubmit()}
    >
      <CardElement options={{ disableLink: true }} />
    </Modal>
  );
}
