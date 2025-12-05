import { useState, useEffect, useCallback } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { CiCreditCard1 } from "react-icons/ci";
import { PaymentMethod } from "shared/types/subscriptions";
import { FaCreditCard } from "react-icons/fa";
import { FaBuildingColumns } from "react-icons/fa6";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { isCloud } from "@/services/env";
import { growthbook } from "@/services/utils";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import { GBAddCircle } from "@/components/Icons";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import LoadingSpinner from "@/components/LoadingSpinner";
import { StripeProvider } from "../Billing/StripeProvider";
import AddPaymentMethodModal from "./AddPaymentMethodModal";

export default function PaymentInfo() {
  const [paymentMethodModal, setPaymentMethodModal] = useState(false);
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState<
    string | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const { subscription, organization } = useUser();
  const { apiCall } = useAuth();
  // TODO: Remove once all orgs have moved license info off of the org - only limit by isCloud()
  // The licenseKey is required to look up payment methods
  const canShowPaymentInfo =
    isCloud() &&
    !!organization.licenseKey &&
    growthbook.getFeatureValue("ff_payment-info", false);

  const fetchPaymentMethods = useCallback(async () => {
    setLoading(true);
    try {
      const res: { paymentMethods: PaymentMethod[] } = await apiCall(
        "/subscription/payment-methods",
        {
          method: "GET",
        },
      );
      setPaymentMethods(res.paymentMethods);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  async function setPaymentMethodAsDefault() {
    if (!defaultPaymentMethod) {
      throw new Error("Must specify payment method id");
    }
    try {
      await apiCall("/subscription/payment-methods/set-default", {
        method: "POST",
        body: JSON.stringify({
          paymentMethodId: defaultPaymentMethod,
        }),
      });
      const updatedPaymentMethodData = paymentMethods.map((paymentMethod) => {
        const updatedPaymentMethod = paymentMethod;
        if (paymentMethod.id === defaultPaymentMethod) {
          paymentMethod.isDefault = true;
        } else if (paymentMethod.isDefault) {
          paymentMethod.isDefault = false;
        }
        return updatedPaymentMethod;
      });
      setPaymentMethods(updatedPaymentMethodData);
    } catch (e) {
      throw new Error(e.message);
    }
  }

  async function detachPaymentMethod(paymentMethodId: string) {
    try {
      const methodIndex = paymentMethods?.findIndex(
        (method) => method.id === paymentMethodId,
      );

      if (paymentMethods?.length === 1 && subscription?.status !== "canceled") {
        throw new Error(
          "Unable to delete payment method. You must have at least 1 payment method on file.",
        );
      }

      if (methodIndex <= -1) {
        throw new Error(
          "Cannot delete: Payment method does not exist on this subscription",
        );
      }
      await apiCall("/subscription/payment-methods/detach", {
        method: "POST",
        body: JSON.stringify({
          paymentMethodId,
        }),
      });

      const updatedData = paymentMethods.toSpliced(methodIndex, 1);
      setPaymentMethods(updatedData);
    } catch (e) {
      throw new Error(e.message);
    }
  }

  useEffect(() => {
    if (canShowPaymentInfo) {
      fetchPaymentMethods();
    }
  }, [canShowPaymentInfo, fetchPaymentMethods]);

  if (!canShowPaymentInfo) return null;

  return (
    <>
      {paymentMethodModal ? (
        <StripeProvider>
          <AddPaymentMethodModal
            onClose={() => setPaymentMethodModal(false)}
            refetch={() => fetchPaymentMethods()}
            numOfMethods={paymentMethods?.length}
          />
        </StripeProvider>
      ) : null}
      {defaultPaymentMethod ? (
        <Modal
          header="Update default payment method"
          open={true}
          cta="Set as default payment method"
          submit={async () => await setPaymentMethodAsDefault()}
          trackingEventModalType=""
          close={() => setDefaultPaymentMethod(undefined)}
        >
          Are your sure? The default payment method will be the one charged on
          future invoices.
        </Modal>
      ) : null}
      <div className="p-3 border mb-3">
        <Flex justify="between" align="center" className="pb-3">
          <h3 className="mb-0">Payment Methods</h3>
          <div>
            <Tooltip
              body="You can only have up to 3 payment methods on file"
              shouldDisplay={paymentMethods?.length > 2}
            >
              <Button
                disabled={paymentMethods?.length > 2}
                onClick={() => {
                  setPaymentMethodModal(true);
                  track("Edit Payment Method Modal", {
                    source: "payment-method-empty-state",
                  });
                }}
              >
                <span className="h4 pr-2 m-0 d-inline-block align-top">
                  <GBAddCircle />
                </span>
                Add Payment Method
              </Button>
            </Tooltip>
          </div>
        </Flex>
        {error ? (
          <Callout status="error">{error}</Callout>
        ) : (
          <>
            {loading ? (
              <Flex justify="center" align="center" className="py-8">
                <LoadingSpinner />
              </Flex>
            ) : (
              <>
                {!paymentMethods?.length ? (
                  <Flex
                    justify="center"
                    align="center"
                    direction="column"
                    className="py-4"
                  >
                    <CiCreditCard1 size={50} />
                    <Text as="label">No payment methods added</Text>
                  </Flex>
                ) : (
                  <table className="table mb-3 appbox gbtable table-hover">
                    <tbody>
                      {paymentMethods.map((method) => {
                        return (
                          <tr key={method.id}>
                            <td>
                              {method.brand}
                              {method.last4 ? (
                                <Text as="span" className="px-2" align="center">
                                  ••••{method.last4}
                                </Text>
                              ) : null}
                              <span className="pr-2">
                                {method.type === "card" ? (
                                  <FaCreditCard size={18} />
                                ) : null}
                                {method.type === "us_bank_account" ? (
                                  <FaBuildingColumns size={18} />
                                ) : null}
                              </span>
                              <span className="pl-2">
                                {method.isDefault ? (
                                  <Badge label="Default" />
                                ) : null}
                                {method.wallet ? (
                                  <Badge label={method.wallet} color="green" />
                                ) : null}
                              </span>
                            </td>
                            <td>
                              <Flex align="center" justify="end">
                                {method.type === "card"
                                  ? `Expires ${method.expMonth}/${method.expYear}`
                                  : null}
                                <MoreMenu className="pl-2">
                                  <button
                                    className="dropdown-item"
                                    disabled={method.isDefault}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setDefaultPaymentMethod(method.id);
                                    }}
                                  >
                                    Set as default
                                  </button>
                                  <Tooltip
                                    tipPosition="left"
                                    body="Before you can delete this card, set another card as the default card"
                                    shouldDisplay={method.isDefault}
                                  >
                                    <DeleteButton
                                      onClick={async () =>
                                        await detachPaymentMethod(method.id)
                                      }
                                      disabled={method.isDefault}
                                      className="dropdown-item text-danger"
                                      displayName="Remove Payment Method"
                                      text="Remove Payment Method"
                                      useIcon={false}
                                    />
                                  </Tooltip>
                                </MoreMenu>
                              </Flex>
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
    </>
  );
}
