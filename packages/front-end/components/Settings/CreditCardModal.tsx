import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { PaymentMethodResult } from "@stripe/stripe-js";
import Modal from "../Modal";

interface Props {
  onClose: () => void;
  paymentProviderId?: string;
  refetch: () => Promise<void>;
}

class AddCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddCardError";
  }
}

export default function CreditCardModal({
  onClose,
  paymentProviderId = "",
  refetch,
}: Props) {
  const elements = useElements();
  const stripe = useStripe();

  const handleSubmit = async () => {
    if (!stripe || !elements) {
      throw new AddCardError(`Can not load Stripe`);
    }

    if (!paymentProviderId) {
      throw new AddCardError("Missing Stripe customer ID");
    }

    try {
      // Create the paymentMethod object
      const result: PaymentMethodResult = await stripe.createPaymentMethod({
        elements,
      });

      if (!result?.paymentMethod) {
        throw new AddCardError(
          result.error.message || "Unable to create a payment object"
        );
      }

      // Attach this payment method to customer
      const updatedCustomer = await fetch(
        `https://api.stripe.com/v1/payment_methods/${result.paymentMethod.id}/attach`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_STRIPE_TEST_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ customer: paymentProviderId }),
        }
      ).then((res) => res.json());

      if (updatedCustomer?.error) {
        throw new AddCardError(updatedCustomer.error.message);
      }
      // Refetch updated list of cards
      await refetch();
    } catch (e) {
      throw new AddCardError(e.message);
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
      <CardElement options={{ disableLink: true }} />
    </Modal>
  );
}
