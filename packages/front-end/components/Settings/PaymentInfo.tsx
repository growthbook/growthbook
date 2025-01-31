import { useState, useEffect, useCallback } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { CiCreditCard1 } from "react-icons/ci";
import { Card } from "shared/src/types/subscriptions";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { GBAddCircle } from "../Icons";
import Callout from "../Radix/Callout";
import Badge from "../Radix/Badge";
import MoreMenu from "../Dropdown/MoreMenu";
import DeleteButton from "../DeleteButton/DeleteButton";
import Modal from "../Modal";
import LoadingSpinner from "../LoadingSpinner";
import StripeProvider from "../Billing/StripeProvider";
import CreditCardModal from "./CreditCardModal";

export default function PaymentInfo() {
  const [cardModal, setCardModal] = useState(false);
  const [defaultCard, setDefaultCard] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [cardData, setCardData] = useState<Card[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const { subscription } = useUser();
  const { apiCall } = useAuth();

  const fetchCardData = useCallback(async () => {
    setLoadingCards(true);
    try {
      if (!subscription?.externalId) {
        throw new Error("Must have a subscription.");
      }
      const res: { cards: Card[] } = await apiCall(
        `/subscription/payment-methods/${subscription.externalId}`,
        {
          method: "GET",
        }
      );
      setCardData(res.cards);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingCards(false);
    }
  }, [apiCall, subscription?.externalId]);

  async function setCardAsDefault() {
    if (!subscription?.externalId) throw new Error("Must have a subscription");
    if (!defaultCard) throw new Error("Must specify card id");
    try {
      await apiCall("/subscription/payment-methods/set-default", {
        method: "POST",
        body: JSON.stringify({
          paymentMethodId: defaultCard,
          subscriptionId: subscription.externalId,
        }),
      });
      fetchCardData();
    } catch (e) {
      throw new Error(e.message);
    }
  }

  async function detachCard(cardId: string) {
    try {
      await apiCall("/subscription/payment-methods/detach", {
        method: "POST",
        body: JSON.stringify({
          paymentMethodId: cardId,
        }),
      });
      fetchCardData();
    } catch (e) {
      throw new Error(e.message);
    }
  }

  useEffect(() => {
    if (subscription?.externalId) {
      fetchCardData();
    }
  }, [apiCall, fetchCardData, subscription]);

  return (
    <>
      <StripeProvider>
        {cardModal ? (
          <CreditCardModal
            onClose={() => setCardModal(false)}
            refetch={() => fetchCardData()}
          />
        ) : null}
        {defaultCard ? (
          <Modal
            header="Update default card"
            open={true}
            cta="Set as default card"
            submit={async () => await setCardAsDefault()}
            trackingEventModalType=""
            close={() => setDefaultCard(undefined)}
          >
            Are your sure? The default card will be the card charged on future
            invoices.
          </Modal>
        ) : null}
        <div className="bg-white p-3 border mb-3">
          <Flex justify="between" align="center" className="pb-3">
            <h3 className="mb-0">Payment Methods</h3>
            <button
              className="btn btn-primary float-right"
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
          </Flex>
          {error ? (
            <Callout status="warning">{error}</Callout>
          ) : (
            <>
              {loadingCards ? (
                <Flex justify="center" align="center" className="py-8">
                  <LoadingSpinner />
                </Flex>
              ) : (
                <>
                  {!cardData.length ? (
                    <Flex
                      justify="center"
                      align="center"
                      direction="column"
                      className="py-4"
                    >
                      <CiCreditCard1 size={50} />
                      <Text as="label">No cards added</Text>
                    </Flex>
                  ) : (
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
                                {card.isDefault ? (
                                  <Badge label="Default Card" />
                                ) : null}
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
                                      setDefaultCard(card.id);
                                    }}
                                  >
                                    Set as Default Card
                                  </button>
                                  <DeleteButton
                                    onClick={async () =>
                                      await detachCard(card.id)
                                    }
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
                  )}
                </>
              )}
            </>
          )}
        </div>
      </StripeProvider>
    </>
  );
}
