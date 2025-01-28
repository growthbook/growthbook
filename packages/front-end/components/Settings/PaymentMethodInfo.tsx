import { useState, useEffect } from "react";
import { Flex } from "@radix-ui/themes";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import track from "@/services/track";
import { GBAddCircle } from "../Icons";
import Tooltip from "../Tooltip/Tooltip";
import Button from "../Button";
import LoadingOverlay from "../LoadingOverlay";
import Callout from "../Radix/Callout";
import CreditCardModal from "./CreditCardModal";

interface Card {
  id: string;
  last4: number;
  brand: string; // change to enum?
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export default function PaymentMethodInfo({
  paymentProviderId,
}: {
  paymentProviderId?: string;
}) {
  const {
    hasActiveSubscription,
    hasPaymentMethod,
    subscriptionType,
    subscriptionStatus,
  } = useStripeSubscription();
  const [cardModal, setCardModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [cardData, setCardData] = useState<Card[] | null>(null); // Use Stripe types
  const { apiCall } = useAuth();

  useEffect(() => {
    const fetchCarDataFromStripe = async () => {
      console.log("fetching data!");
      setLoading(true);
      setError(undefined);
      try {
        // // Handle API call here
        // const res = await fetch(url, {
        //   method: "GET",
        //   headers: {
        //     Authorization: `Bearer ${
        //       process.env.NEXT_PUBLIC_STRIPE_TEST_KEY
        //     }`,
        //   },
        // });
        // const body = await res.json();
        // if (body.data) {
        //   const cards: Card[] = [];
        //   body.data.forEach((paymentMethod) => {
        //     if (paymentMethod.type === "card") {
        //       cards.push({
        //         id: paymentMethod.id,
        //         last4: paymentMethod.card.last4,
        //         brand: paymentMethod.card.brand,
        //         expMonth: paymentMethod.card.exp_month,
        //         expYear: paymentMethod.card.exp_year,
        //       });
        //     }
        //   });
        //   setCardData(cards);
        // }
        // Fetch customer details to get the default_payment_method
        const customerResponse = await fetch(
          `https://api.stripe.com/v1/customers/${paymentProviderId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_STRIPE_TEST_KEY}`,
            },
          }
        );

        console.log("customerResponse", customerResponse);

        if (!customerResponse.ok) {
          throw new Error(
            `Failed to fetch customer: ${customerResponse.statusText}`
          );
        }

        const customer = await customerResponse.json();
        const defaultPaymentMethodId =
          customer.invoice_settings?.default_payment_method;

        console.log("defaultPaymentMethod", defaultPaymentMethodId);

        const paymentMethodsUrl = new URL(
          `https://api.stripe.com/v1/customers/${paymentProviderId}/payment_methods`
        );

        paymentMethodsUrl.searchParams.append("type", "card");

        // Fetch all payment methods
        const paymentMethodsResponse = await fetch(paymentMethodsUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_STRIPE_TEST_KEY}`,
          },
        });

        console.log("paymentMethodsResponse", paymentMethodsResponse);

        if (!paymentMethodsResponse.ok) {
          throw new Error(
            `Failed to fetch payment methods: ${paymentMethodsResponse.statusText}`
          );
        }

        const paymentMethods = await paymentMethodsResponse.json();

        console.log("paymentMethods", paymentMethods);

        if (!paymentMethods.data || !paymentMethods.data.length) {
          // log error
          return;
        }

        // Identify the default payment method
        const paymentMethodsWithDefaultFlag = paymentMethods.data.map(
          (method) => {
            const card = method.card;
            return {
              last4: card.last4,
              brand: card.display_brand,
              expMonth: card.exp_month,
              expYear: card.exp_year,
              isDefault: method.id === defaultPaymentMethodId,
            };
          }
        );

        setCardData(paymentMethodsWithDefaultFlag);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    };

    if (subscriptionType === "orb" && paymentProviderId) {
      fetchCarDataFromStripe();
    }
  }, [paymentProviderId, subscriptionType]);

  if (loading) return <LoadingOverlay />;

  if (subscriptionType === "orb" && !paymentProviderId) {
    // need to return an error that their subscription isn't configured
    return (
      <Callout status="error">
        Your organization&apos;s subscription is not configured correctly.
        Missing <code>paymentProviderId</code>
      </Callout>
    );
  }

  console.log("cardData", cardData);

  return (
    <>
      {cardModal ? (
        <CreditCardModal onClose={() => setCardModal(false)} />
      ) : null}
      {subscriptionType === "stripe" ? (
        <div
          className="appbox d-flex flex-column align-items-center w-auto"
          style={{ padding: "70px 305px 60px 305px" }}
        >
          <h1 className="text-center">Your card is managed by Stripe</h1>
          <Button
            color="primary"
            onClick={async () => {
              const res = await apiCall<{ url: string }>(
                `/subscription/manage`,
                {
                  method: "POST",
                }
              );
              if (res && res.url) {
                await redirectWithTimeout(res.url);
              } else {
                throw new Error("Unknown response");
              }
            }}
          >
            {subscriptionStatus !== "canceled"
              ? "View Plan Details"
              : "View Previous Invoices"}
          </Button>
        </div>
      ) : (
        <>
          {!hasPaymentMethod ? (
            <div
              className="appbox d-flex flex-column align-items-center" // Fix styling here - box isn't very wide
              style={{ padding: "70px 305px 60px 305px" }}
            >
              <h1>Add a Card</h1>
              <p style={{ fontSize: "17px" }}>
                Payments for plans, usage, and other add-ons are made using the
                default credit card.
              </p>
              <div className="row">
                <Tooltip
                  shouldDisplay={!hasActiveSubscription}
                  body="You must have an active subscription before you can add a credit card."
                >
                  <button
                    className="btn btn-primary float-right"
                    disabled={!hasActiveSubscription}
                    onClick={() => {
                      setCardModal(true);
                      track("Edit Card Modal", {
                        source: "payment-method-empty-state",
                      });
                    }}
                    type="button"
                  >
                    <span className="h4 pr-2 m-0 d-inline-block align-top">
                      <GBAddCircle />
                    </span>
                    Add Card
                  </button>
                </Tooltip>
              </div>
            </div>
          ) : null}
          {cardData?.length ? (
            <div
              className="appbox d-flex flex-column align-items-center" // Fix styling here - box isn't very wide
              style={{ padding: "70px 305px 60px 305px" }}
            >
              {cardData.map((card) => {
                return (
                  <Flex key={card.id}>
                    <div>
                      {card.brand} ....{card.last4}
                      {card.isDefault ? "DEFAULT" : ""}
                    </div>
                    <div>
                      Valid Until {card.expMonth}/{card.expYear}
                    </div>
                  </Flex>
                );
              })}
              {/* <Flex>
                <div>
                  {cardData.brand} ....{cardData.last4}
                </div>
                <div>
                  Valid Until {cardData.expMonth}/{cardData.expYear}
                </div>
              </Flex> */}
            </div>
          ) : null}
          {/* MKTODO: Display card data here when we have it */}
        </>
      )}
    </>
  );
}
