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
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";
import { taxIdTypeOptions } from "@/enterprise/components/Billing/CloudProUpgradeModal";

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
  const [taxConfigChanged, setTaxConfigChanged] = useState(false);
  const [customerDataError, setCustomerDataError] = useState<string | null>(
    null
  );
  const { clientSecret } = useStripeContext();
  const { organization, email, users } = useUser();
  const { apiCall } = useAuth();
  const elements = useElements();
  const stripe = useStripe();

  const form = useForm<{
    address: StripeAddress;
    name: string;
    email: string;
    additionalEmails: string[];
    taxIdType?: TaxIdType;
    taxIdValue?: string;
  }>({
    defaultValues: {
      name: organization.name,
      email: email,
      additionalEmails: [],
      taxIdType: undefined,
      taxIdValue: undefined,
      address: {
        line1: "",
        line2: "",
        city: "",
        state: "",
        postal_code: "",
        country: "",
      },
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
          form.setValue("address", customerData.address);

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

      const addressElement = elements.getElement("address");

      if (!addressElement) {
        throw new Error("Unable to get address element");
      }

      const { complete, value } = await addressElement.getValue();

      if (complete && value) {
        form.setValue("address", value.address);
        form.setValue("name", value.name);
      }

      if (taxConfigChanged) {
        // Check to see if the taxConfig was changed
        await apiCall("subscription/update-customer-data", {
          method: "POST",
          body: JSON.stringify({
            taxConfig: {
              type: form.watch("taxIdType"),
              value: form.watch("taxIdValue"),
            },
          }),
        });
      }
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

        <MultiSelectField
          label="Additional Emails (Optional)"
          helpText="Specify additional email addresses that will be CC'd on monthly invoice emails."
          options={[
            ...Array.from(users.values()).map((user) => ({
              label: user.email,
              value: user.email,
            })),
            // Add any additional emails that might not be in users but are in the form value
            ...form
              .watch("additionalEmails")
              .filter(
                (email) =>
                  !Array.from(users.values()).some(
                    (user) => user.email === email
                  )
              )
              .map((email) => ({
                label: email,
                value: email,
              })),
          ]}
          value={form.watch("additionalEmails")}
          onChange={(value) => {
            form.setValue("additionalEmails", value, { shouldValidate: true });
          }}
          creatable={true}
        />

        <Flex align="center" width="100%" gap="4" className="mb-3">
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
                setTaxConfigChanged(true);
              }}
              isClearable={true}
            />
          </Box>
          <Box style={{ width: "50%" }}>
            <Field
              type="text"
              {...form.register("taxIdValue")}
              onChange={(e) => {
                form.setValue("taxIdValue", e.target.value);
                setTaxConfigChanged(true);
              }}
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

        <div className="mb-3">
          <label className="form-label">Billing Address</label>
          {!fetchingCustomerData && (
            <AddressElement
              options={{
                mode: "billing",
                fields: {
                  phone: "never",
                },
                display: {
                  name: "organization",
                },
                defaultValues: {
                  name: form.watch("name"),
                  address: {
                    line1: form.watch("address").line1,
                    line2: form.watch("address").line2,
                    city: form.watch("address").city,
                    state: form.watch("address").state,
                    postal_code: form.watch("address").postal_code,
                    country: form.watch("address").country || "",
                  },
                },
              }}
            />
          )}
          {fetchingCustomerData && (
            <div className="p-3 text-muted">Loading address data...</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
