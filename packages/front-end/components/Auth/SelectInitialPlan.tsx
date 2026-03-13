import { FC, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import {
  AddressElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useForm, UseFormReturn } from "react-hook-form";
import { TaxIdType, StripeAddress } from "shared/types/subscriptions";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { InitialPlanSelection, useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { StripeProvider } from "@/enterprise/components/Billing/StripeProvider";
import { useStripeContext } from "@/hooks/useStripeContext";
import { taxIdTypeOptions } from "@/enterprise/components/Billing/CloudProUpgradeModal";
import RadioCards from "@/ui/RadioCards";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";
import Checkbox from "@/ui/Checkbox";
import Button from "@/components/Button";
import LoadingOverlay from "@/components/LoadingOverlay";
import WelcomeFrame from "./WelcomeFrame";

const leftside = (
  <>
    <h1 className="title h1">Confirm your plan</h1>
    <p>You can change this later in your account settings.</p>
  </>
);
type ProBillingData = {
  email: string;
  taxIdType?: TaxIdType;
  taxIdValue?: string;
};

const SelectInitialPlan: FC = () => {
  const router = useRouter();
  const { initialPlanSelection, setInitialPlanSelection } = useAuth();
  const { email } = useUser();
  const plan: InitialPlanSelection =
    initialPlanSelection === "pro" || initialPlanSelection === "starter"
      ? initialPlanSelection
      : "starter";
  const setPlan = setInitialPlanSelection ?? (() => {});
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const billingForm = useForm<ProBillingData>({
    defaultValues: {
      email: email ?? "",
      taxIdType: undefined,
      taxIdValue: undefined,
    },
  });

  const completeFlow = useCallback(() => {
    setInitialPlanSelection?.("");
    router.push("/");
  }, [router, setInitialPlanSelection]);

  const handleStarter = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      completeFlow();
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    setStep((s) => s + 1);
    setError(null);
  };

  const handleBack = () => {
    setStep((s) => s - 1);
    setError(null);
  };

  return (
    <WelcomeFrame leftside={leftside} pathName="/select-initial-plan">
      {step === 1 && (
        <Flex direction="column" gap="4" width="100%">
          <Heading as="h1">Plan options</Heading>
          <RadioCards
            options={[
              {
                value: "starter",
                label: (
                  <Flex
                    direction="row"
                    align="baseline"
                    justify="between"
                    gap="2"
                  >
                    <Heading as="h2" size="small">
                      Starter
                    </Heading>
                    <Text color="text-low">Free</Text>
                  </Flex>
                ),
                description: (
                  <Flex direction="column" gap="3" className="mt-3">
                    <Text color="text-low">
                      Basic flags and experiments for solo devs and small teams
                    </Text>
                    <ul
                      style={{
                        paddingLeft: 0,
                        marginLeft: 0,
                        listStylePosition: "inside",
                      }}
                    >
                      <li>Unlimited feature flags</li>
                      <li>Unlimited experiments</li>
                      <li>Add up to 3 seats</li>
                      <li>1M CDN Requests/month</li>
                      <li>5GB Bandwidth/month</li>
                    </ul>
                    <Button
                      color="primary"
                      onClick={handleStarter}
                      disabled={loading || plan !== "starter"}
                    >
                      Get Started for Free
                    </Button>
                  </Flex>
                ),
              },
              {
                value: "pro",
                label: (
                  <Flex
                    direction="row"
                    align="baseline"
                    justify="between"
                    gap="2"
                  >
                    <Heading as="h2" size="small">
                      Pro
                    </Heading>
                    <Text color="text-low">Starts at $40/month</Text>
                  </Flex>
                ),
                description: (
                  <Flex direction="column" gap="3" className="mt-3">
                    <Text color="text-low">
                      Full featured experimentation and growth platform
                    </Text>
                    <ul
                      style={{
                        paddingLeft: 0,
                        marginLeft: 0,
                        listStylePosition: "inside",
                      }}
                    >
                      <li>Advanced statistics</li>
                      <li>Add up to 50 seats</li>
                      <li>Advanced permissions</li>
                      <li>2M CDN Requests/month</li>
                      <li>20GB Bandwidth/month</li>
                    </ul>
                    <Button
                      color="primary"
                      onClick={() => handleNext()}
                      disabled={loading || plan !== "pro"}
                    >
                      Next: Add Payment Details
                    </Button>
                  </Flex>
                ),
              },
            ]}
            value={plan}
            align="start"
            setValue={(v) => setPlan(v as InitialPlanSelection)}
            columns="2"
            width="100%"
          />
          {error && <div className="alert alert-danger mt-3">{error}</div>}
        </Flex>
      )}
      {step === 2 && (
        <ProBillingStep
          form={billingForm}
          onNext={handleNext}
          onBack={handleBack}
          setError={setError}
        />
      )}
      {step === 3 && (
        <ProPaymentStep
          getBillingData={() => billingForm.getValues()}
          onSuccess={() => handleNext()}
          onBack={handleBack}
          setLoading={setLoading}
          setError={setError}
        />
      )}
      {step >= 4 && (
        <div style={{ maxWidth: "500px" }}>
          <h2 className="h3 mb-1">Welcome to GrowthBook Pro!</h2>
          <p className="text-muted mb-3">
            You&apos;re all set! Go to your GrowthBook dashboard to start your
            setup.
          </p>
          <Button color="primary" onClick={completeFlow} disabled={loading}>
            Get started
          </Button>
        </div>
      )}
    </WelcomeFrame>
  );
};

type ProBillingStepProps = {
  form: UseFormReturn<ProBillingData>;
  onNext: () => void;
  onBack: () => void;
  setError: (v: string | null) => void;
};

const ProBillingStep: FC<ProBillingStepProps> = ({
  form,
  onNext,
  onBack,
  setError,
}) => {
  const handleNext = () => {
    setError(null);
    form.handleSubmit(() => onNext())();
  };

  return (
    <div>
      <Heading as="h2" mb="1">
        Billing details
      </Heading>
      <Text color="text-low" mb="4" as="p">
        Enter your billing information. You can add your payment method next.
      </Text>
      <Field
        type="email"
        required={true}
        label="Billing email"
        helpText="Monthly invoices will be sent to this address"
        {...form.register("email", { required: true })}
      />
      <Flex gap="4">
        <Box style={{ flex: 1 }}>
          <SelectField
            label="Tax ID type"
            options={taxIdTypeOptions}
            value={form.watch("taxIdType") || ""}
            placeholder="(optional)"
            onChange={(value) => form.setValue("taxIdType", value as TaxIdType)}
            isClearable={true}
          />
        </Box>
        <Box style={{ flex: 1 }}>
          <Field
            type="text"
            {...form.register("taxIdValue")}
            placeholder="(optional)"
            label={
              <Flex align="center">
                <span className="mr-1">Tax ID</span>
                <Tooltip body="Enter your tax id here. E.G. VAT or EIN">
                  <GBInfo />
                </Tooltip>
              </Flex>
            }
          />
        </Box>
      </Flex>
      <Flex width="100%" justify="between">
        <Button color="secondary" onClick={onBack}>
          Back
        </Button>
        <Button color="primary" onClick={handleNext}>
          Next
        </Button>
      </Flex>
    </div>
  );
};

type ProPaymentStepProps = {
  getBillingData: () => ProBillingData;
  onSuccess: () => void;
  onBack: () => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
};

const ProPaymentStep: FC<ProPaymentStepProps> = ({
  getBillingData,
  onSuccess,
  onBack,
  setLoading,
  setError,
}) => {
  const { apiCall } = useAuth();
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiCall<{ clientSecret: string }>("/subscription/setup-intent", {
      method: "POST",
    })
      .then((res) => {
        if (!cancelled && res?.clientSecret) {
          setClientSecret(res.clientSecret);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Failed to start setup");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiCall, setLoading, setError]);

  if (!clientSecret) {
    return <LoadingOverlay />;
  }

  return (
    <StripeProvider initialClientSecret={clientSecret}>
      <ProPaymentFormInner
        getBillingData={getBillingData}
        onSuccess={onSuccess}
        onBack={onBack}
        setLoading={setLoading}
        setError={setError}
      />
    </StripeProvider>
  );
};

type ProPaymentFormProps = {
  getBillingData: () => ProBillingData;
  onSuccess: () => void;
  onBack: () => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
};

const ProPaymentFormInner: FC<ProPaymentFormProps> = ({
  getBillingData,
  onSuccess,
  onBack,
  setLoading,
  setError,
}) => {
  const { apiCall } = useAuth();
  const { organization, refreshOrganization } = useUser();
  const stripe = useStripe();
  const elements = useElements();
  const { clientSecret } = useStripeContext();
  const [showAddress, setShowAddress] = useState(false);
  const form = useForm<{ name: string; address?: StripeAddress }>({
    defaultValues: { name: organization?.name || "" },
  });

  const handleSubmit = async () => {
    if (!stripe || !elements || !clientSecret) return;
    setError(null);
    setLoading(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(
          submitError.message || "Unable to validate payment method inputs",
        );
      }
      let address: StripeAddress | undefined;
      if (showAddress) {
        const addressElement = elements.getElement("address");
        if (addressElement) {
          const { complete, value } = await addressElement.getValue();
          if (complete && value) {
            form.setValue("name", value.name);
            address = value.address;
          }
        }
      }
      const billingData = getBillingData();
      await stripe.confirmSetup({
        elements,
        clientSecret,
        redirect: "if_required",
      });
      await apiCall("/subscription/start-new-pro", {
        method: "POST",
        body: JSON.stringify({
          name: form.getValues("name") || organization?.name,
          address,
          email: billingData.email,
          taxConfig:
            billingData.taxIdType && billingData.taxIdValue
              ? {
                  type: billingData.taxIdType,
                  value: billingData.taxIdValue,
                }
              : undefined,
        }),
      });
      await refreshOrganization();
      setLoading(false);
      onSuccess();
    } catch (e) {
      setLoading(false);
      setError(e?.message || "Something went wrong");
    }
  };

  return (
    <div style={{ maxWidth: "500px" }}>
      <Heading as="h2" mb="3">
        Add payment method
      </Heading>
      <div className="mb-4">
        <PaymentElement />
        <p className="pt-3 text-muted" style={{ fontSize: "14px" }}>
          You will be charged a pro-rated amount for the remainder of this
          month, and $40 per month per seat thereafter. Cancel anytime.
        </p>
      </div>
      <div className="mb-4">
        <Checkbox
          label="Customize invoice"
          value={showAddress}
          setValue={setShowAddress}
          description="Add a billing address and customize the name displayed on invoices."
        />
      </div>
      {showAddress && (
        <div className="mb-4">
          <AddressElement
            options={{
              mode: "billing",
              fields: { phone: "never" },
              display: { name: "organization" },
              defaultValues: { name: organization?.name || "" },
            }}
          />
        </div>
      )}
      <Flex gap="2" width="100%" justify="between">
        <Button color="secondary" onClick={onBack}>
          Back
        </Button>
        <Button color="primary" onClick={handleSubmit}>
          Next
        </Button>
      </Flex>
    </div>
  );
};

export default SelectInitialPlan;
