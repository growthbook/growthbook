import { useState, useEffect, useCallback } from "react";
import { Flex, Text } from "@radix-ui/themes";
import useStripeSubscription from "@/hooks/useStripeSubscription";
import { redirectWithTimeout, useAuth } from "@/services/auth";
import track from "@/services/track";
import { GBAddCircle } from "../Icons";
import Tooltip from "../Tooltip/Tooltip";
import Button from "../Button";
import LoadingOverlay from "../LoadingOverlay";
import Callout from "../Radix/Callout";
import MoreMenu from "../Dropdown/MoreMenu";
import DeleteButton from "../DeleteButton/DeleteButton";
import Badge from "../Radix/Badge";
import Modal from "../Modal";
import CreditCardModal from "./CreditCardModal";

type StripeErrorResponse = {
  error: {
    message: string;
  };
  invoice_settings?: never;
  data?: never;
};

type StripeCustomerSuccessResponse = {
  invoice_settings: {
    default_payment_method?: string;
  };
  error?: never;
};

type StripePaymentMethodSuccessResponse = {
  data: {
    id: string;
    card: {
      brand: string;
      exp_month: number;
      exp_year: number;
      last4: string;
    };
  }[];
  error?: never;
};

// type StripeApiResponse = StripeErrorResponse | StripeSuccessResponse;

interface Card {
  id: string;
  last4: string;
  brand: string;
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
    subscriptionType,
    subscriptionStatus,
  } = useStripeSubscription();
  const [cardModal, setCardModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [cardData, setCardData] = useState<Card[] | null>(null); // Use Stripe types
  const { apiCall } = useAuth();
  const [defaultCardModal, setDefaultCardModal] = useState<string | undefined>(
    undefined
  );

  const fetchCardData = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      // Fetch customer details to get the default_payment_method
      const res:
        | StripeErrorResponse
        | StripeCustomerSuccessResponse = await fetch(
        `https://api.stripe.com/v1/customers/${paymentProviderId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_STRIPE_TEST_KEY}`,
          },
        }
      ).then((res) => res.json());

      if (res.error) {
        throw new Error(res.error.message);
      }

      const paymentMethodsUrl = new URL(
        `https://api.stripe.com/v1/customers/${paymentProviderId}/payment_methods`
      );

      paymentMethodsUrl.searchParams.append("type", "card");

      // Fetch all payment methods
      const paymentMethods:
        | StripePaymentMethodSuccessResponse
        | StripeErrorResponse = await fetch(paymentMethodsUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_STRIPE_TEST_KEY}`,
        },
      }).then((updatePaymentsRes) => updatePaymentsRes.json());

      if (paymentMethods.error) {
        throw new Error(
          paymentMethods.error.message ||
            "Unable to fetch customer payment methods"
        );
      }

      const defaultPaymentMethodId =
        res.invoice_settings?.default_payment_method;

      // Identify the default payment method
      const paymentMethodsWithDefaultFlag: Card[] = paymentMethods.data.map(
        (method, i) => {
          const card = method.card;
          return {
            id: method.id,
            last4: card.last4,
            brand: card.brand,
            expMonth: card.exp_month,
            expYear: card.exp_year,
            // if no explicit defaultPaymentMethodId, Orb uses the first card
            isDefault: defaultPaymentMethodId
              ? method.id === defaultPaymentMethodId
              : !!(i === 0),
          };
        }
      );

      setCardData(paymentMethodsWithDefaultFlag);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [paymentProviderId]);

  async function detachCard(cardId: string) {
    try {
      const res:
        | StripeErrorResponse
        | { id: string; error?: never } = await fetch(
        `https://api.stripe.com/v1/payment_methods/${cardId}/detach`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_STRIPE_TEST_KEY}`,
          },
        }
      ).then((res) => res.json());

      if (res.error) {
        throw new Error(
          res.error.message || "Unable to remove card from account."
        );
      }
      fetchCardData();
    } catch (e) {
      throw new Error(e.message);
    }
  }

  async function setCardAsDefault() {
    if (!defaultCardModal) throw new Error("Must specify card id");
    try {
      const res:
        | StripeErrorResponse
        | { id: string; error?: never } = await fetch(
        `https://api.stripe.com/v1/customers/${paymentProviderId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_STRIPE_TEST_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            "invoice_settings[default_payment_method]": defaultCardModal,
          }),
        }
      ).then((res) => res.json());
      if (res.error) {
        throw new Error(res.error.message || "Unable to update default card.");
      }
      fetchCardData();
    } catch (e) {
      throw new Error(e.message);
    }
  }

  useEffect(() => {
    if (subscriptionType === "orb" && paymentProviderId) {
      fetchCardData();
    }
  }, [fetchCardData, paymentProviderId, subscriptionType]);

  if (loading) return <LoadingOverlay />;

  if (subscriptionType === "orb" && !paymentProviderId) {
    return (
      <Callout status="error">
        Your organization&apos;s subscription is not configured correctly.
        Missing <code>paymentProviderId</code>
      </Callout>
    );
  }

  return (
    <>
      {error ? <Callout status="error">{error}</Callout> : null}
      {cardModal ? (
        <CreditCardModal
          onClose={() => setCardModal(false)}
          paymentProviderId={paymentProviderId}
          refetch={fetchCardData}
        />
      ) : null}
      {defaultCardModal ? (
        <Modal
          header="Update default card"
          open={true}
          cta="Set as default card"
          submit={async () => await setCardAsDefault()}
          trackingEventModalType=""
          close={() => setDefaultCardModal(undefined)}
        >
          Are your sure? The default card will be the card charged on future
          invoices.
        </Modal>
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
          <Flex align="center" justify="between" className="mb-3">
            <Text as="p" className="mb-0">
              Payments for subscription and usage charges are made with the
              default card.
            </Text>
            <Tooltip
              shouldDisplay={!hasActiveSubscription}
              body="You must have an active subscription before you can add a credit card."
            >
              <button
                className="btn btn-primary float-right"
                disabled={!hasActiveSubscription || !paymentProviderId}
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
          </Flex>
          {cardData?.length ? (
            <table className="table mb-3 appbox gbtable">
              <thead>
                <tr>
                  <th className="col-8">Card Details</th>
                  <th className="col-4">Valid Until</th>
                  <th className="col-2"></th>
                </tr>
              </thead>
              <tbody>
                {cardData.map((card) => {
                  return (
                    <tr key={card.id}>
                      <td>
                        {card.brand}
                        <Text as="span" className="px-2">
                          ••••{card.last4}
                        </Text>
                        {card.isDefault ? <Badge label="Default Card" /> : null}
                      </td>
                      <td>
                        {card.expMonth}/{card.expYear}
                      </td>
                      <td>
                        <MoreMenu className="pl-2">
                          <button
                            className="dropdown-item"
                            disabled={card.isDefault}
                            onClick={(e) => {
                              e.preventDefault();
                              setDefaultCardModal(card.id);
                            }}
                          >
                            Set as Default Card
                          </button>
                          <DeleteButton
                            onClick={async () => await detachCard(card.id)}
                            className="dropdown-item text-danger"
                            displayName="Remove Card"
                            text="Remove Card"
                            useIcon={false}
                          />
                        </MoreMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
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
          )}
        </>
      )}
    </>
  );
}
