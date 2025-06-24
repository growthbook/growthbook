import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import {
  AddressElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { TaxIdType, StripeAddress } from "shared/src/types";
import { SubscriptionInfo } from "shared/enterprise";
import { useStripeContext } from "@/hooks/useStripeContext";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";
import { taxIdTypeOptions } from "@/enterprise/components/Billing/CloudProUpgradeModal";
import Toggle from "../Forms/Toggle";

interface StripeCustomerData {
  name: string;
  email: string;
  address: StripeAddress;
  taxConfig: {
    type?: TaxIdType;
    value?: string;
  };
}

interface Props {
  subscription?: SubscriptionInfo;
  close: () => void;
}

export default function UpdateOrbSubscriptionModal({
  subscription,
  close,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [fetchingCustomerData, setFetchingCustomerData] = useState(false);
  const [customerDataError, setCustomerDataError] = useState<string | null>(
    null
  );
  const [showAddress, setShowAddress] = useState(false);
  const [hasExistingAddress, setHasExistingAddress] = useState(false);
  const { clientSecret } = useStripeContext();
  const { organization, email } = useUser();
  const { apiCall } = useAuth();
  const elements = useElements();
  const stripe = useStripe();

  const form = useForm<{
    address?: StripeAddress;
    name: string;
    email: string;
    taxIdType?: TaxIdType;
    taxIdValue?: string;
  }>({
    defaultValues: {
      name: organization.name,
      email: email,
      taxIdType: undefined,
      taxIdValue: undefined,
      address: undefined,
    },
  });

  // Fetch customer data from Stripe when component mounts
  useEffect(() => {
    const fetchCustomerData = async () => {
      setFetchingCustomerData(true);
      setCustomerDataError(null);

      try {
        if (!subscription) {
          throw new Error("No subscription found");
        }

        if (subscription.billingPlatform !== "orb") {
          throw new Error(
            "Updating subscription details is not available for this subscription type."
          );
        }

        if (subscription.isVercelIntegration) {
          throw new Error(
            "To update your subscription details, please go to your Vercel Integration Dashboard."
          );
        }

        const customerData = await apiCall<StripeCustomerData>(
          `/subscription/customer-data`,
          {
            method: "GET",
          }
        );

        // Update form values with fetched data
        if (customerData) {
          form.setValue("name", customerData.name);
          form.setValue("email", customerData.email);

          if (customerData.address) {
            form.setValue("address", customerData.address);
            setShowAddress(true);
            setHasExistingAddress(true);
          }

          if (customerData.taxConfig?.type) {
            form.setValue("taxIdType", customerData.taxConfig.type);
          }
          if (customerData.taxConfig?.value) {
            form.setValue("taxIdValue", customerData.taxConfig.value);
          }
        }
      } catch (error) {
        console.error("Failed to fetch customer data:", error);
        setCustomerDataError(
          "Failed to load existing customer data from Stripe"
        );
      } finally {
        setFetchingCustomerData(false);
      }
    };

    fetchCustomerData();
  }, [apiCall, organization.name, email, form, subscription]);

  const handleSubmit = async () => {
    if (!stripe || !elements || !clientSecret) return;

    setLoading(true);
    try {
      // Validate inputs
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(
          submitError.message || "Unable to validate address inputs"
        );
      }

      if (showAddress) {
        const addressElement = elements.getElement("address");

        if (!addressElement) {
          throw new Error("Unable to get address element");
        }

        const { complete, value } = await addressElement.getValue();

        if (complete && value) {
          form.setValue("address", value.address);
          form.setValue("name", value.name);
        }
      }

      // If showAddress is false, clear the address to ignore address changes
      if (!showAddress && form.watch("address")) {
        form.setValue("address", undefined);
      }

      // Submit all customer data to our backend to update the subscription
      await apiCall("/subscription/update-customer-data", {
        method: "POST",
        body: JSON.stringify({
          name: form.watch("name"),
          email: form.watch("email"),
          address: form.watch("address"),
          taxConfig: {
            type: form.watch("taxIdType"),
            value: form.watch("taxIdValue"),
          },
        }),
      });

      setLoading(false);
      close();
    } catch (e) {
      setLoading(false);
      throw new Error(e.message);
    }
  };

  return (
    <Modal
      trackingEventModalType="update-orb-subscription"
      open={true}
      close={close}
      size="lg"
      header="Update Subscription Details"
      cta="Update Details"
      submit={handleSubmit}
      loading={loading || fetchingCustomerData}
      autoCloseOnSubmit={false}
    >
      <div className="p-3">
        <p>Update your subscription billing details and preferences.</p>

        {customerDataError && (
          <div className="alert alert-warning mb-3">{customerDataError}</div>
        )}

        {fetchingCustomerData && (
          <div className="mb-3">
            <small className="text-muted">
              Loading existing customer data...
            </small>
          </div>
        )}
        <Field
          type="email"
          required={true}
          label="Primary Email"
          helpText="The primary email address that will receive monthly invoice emails."
          {...form.register("email")}
          defaultValue={form.watch("email")}
        />
        <Flex align="center" width="100%" gap="4">
          <Box style={{ width: "50%" }}>
            <SelectField
              label={
                <span>
                  Tax ID Type{" "}
                  <Tooltip body="Select your tax id type here. E.G. US-EIN, GB-VAT, etc.">
                    <GBInfo />
                  </Tooltip>
                </span>
              }
              options={taxIdTypeOptions}
              value={form.watch("taxIdType") || ""}
              onChange={(value) => {
                form.setValue("taxIdType", value as TaxIdType);
              }}
              isClearable={true}
            />
          </Box>
          <Box style={{ width: "50%" }}>
            <Field
              type="text"
              {...form.register("taxIdValue")}
              label={
                <span>
                  Tax ID{" "}
                  <Tooltip body="Enter your tax id here. E.G. VAT or EIN">
                    <GBInfo />
                  </Tooltip>
                </span>
              }
            />
          </Box>
        </Flex>
        <hr />

        {!fetchingCustomerData ? (
          <>
            <div className="d-flex align-items-center mb-2">
              {!hasExistingAddress ? (
                <>
                  <Toggle
                    id="address-toggle"
                    value={showAddress}
                    setValue={setShowAddress}
                  />
                  <label htmlFor="address-toggle" className="mb-0 ml-2">
                    Add billing address (optional)
                  </label>
                </>
              ) : null}
            </div>

            {showAddress && (
              <AddressElement
                className="pb-2"
                options={{
                  mode: "billing",
                  fields: {
                    phone: "never",
                  },
                  defaultValues: {
                    name: organization.name,
                    address: {
                      line1: form.watch("address")?.line1,
                      line2: form.watch("address")?.line2,
                      city: form.watch("address")?.city,
                      state: form.watch("address")?.state,
                      postal_code: form.watch("address")?.postal_code,
                      country: form.watch("address")?.country || "",
                    },
                  },
                }}
              />
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
