import { FC, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import {
  AddressElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useForm } from "react-hook-form";
import { TaxIdType, StripeAddress } from "shared/types/subscriptions";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import {
  useAuth,
  getSignupPlanFromCookie,
  clearSignupPlanCookie,
} from "@/services/auth";
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
    <h1 className="title h1">Choose your plan</h1>
    <p>
      Select the plan that works best for your team. You can change this later
      in settings.
    </p>
  </>
);

type PlanChoice = "starter" | "pro";

export type ProBillingData = {
  email: string;
  taxIdType?: TaxIdType;
  taxIdValue?: string;
};

const SelectInitialPlan: FC = () => {
  const router = useRouter();
  const { setPendingInitialPlanSelection } = useAuth();
  const { email } = useUser();
  const [plan, setPlan] = useState<PlanChoice>(() => getSignupPlanFromCookie());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [proSuccess, setProSuccess] = useState(false);
  const [proPaymentReady, setProPaymentReady] = useState(false);
  const [proStep, setProStep] = useState<"billing" | "payment">("billing");
  const [proBillingData, setProBillingData] = useState<ProBillingData | null>(
    null,
  );

  const completeFlow = useCallback(() => {
    clearSignupPlanCookie();
    setPendingInitialPlanSelection?.(false);
    router.push("/");
  }, [router, setPendingInitialPlanSelection]);

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

  const handleProContinue = () => {
    setError(null);
    if (plan === "pro") {
      setProPaymentReady(true);
      setProStep("billing");
    }
  };

  const handleBackToPlanSelection = () => {
    setProPaymentReady(false);
    setProStep("billing");
    setProBillingData(null);
    setError(null);
  };

  const handleBackToBilling = () => {
    setProStep("billing");
    setClientSecret(null);
    setError(null);
  };

  if (proSuccess) {
    return (
      <WelcomeFrame leftside={leftside} pathName="/select-initial-plan">
        <div style={{ maxWidth: "500px" }}>
          <h2 className="h3 mb-3">Welcome to GrowthBook Pro!</h2>
          <p className="text-muted mb-4">
            You&apos;re all set! Your organization now has access to all
            GrowthBook Pro features.
          </p>
          <Button color="primary" onClick={completeFlow} disabled={loading}>
            Go to dashboard
          </Button>
        </div>
      </WelcomeFrame>
    );
  }

  if (plan === "pro" && proPaymentReady && proStep === "billing") {
    return (
      <WelcomeFrame leftside={leftside} pathName="/select-initial-plan">
        <ProBillingStep
          initialData={proBillingData}
          defaultEmail={email || ""}
          onNext={(data) => {
            setProBillingData(data);
            setProStep("payment");
            setError(null);
          }}
          onBack={handleBackToPlanSelection}
          setError={setError}
        />
      </WelcomeFrame>
    );
  }

  if (
    plan === "pro" &&
    proPaymentReady &&
    proStep === "payment" &&
    clientSecret &&
    proBillingData
  ) {
    return (
      <WelcomeFrame leftside={leftside} pathName="/select-initial-plan">
        <ProPaymentForm
          clientSecret={clientSecret}
          billingData={proBillingData}
          onSuccess={() => setProSuccess(true)}
          onCompleteFlow={completeFlow}
          onBack={handleBackToBilling}
          setLoading={setLoading}
          setError={setError}
        />
      </WelcomeFrame>
    );
  }

  if (plan === "pro" && proPaymentReady && proStep === "payment") {
    return (
      <WelcomeFrame leftside={leftside} pathName="/select-initial-plan">
        <ProSetupStep
          onClientSecret={(secret) => setClientSecret(secret)}
          setLoading={setLoading}
          setError={setError}
        />
      </WelcomeFrame>
    );
  }

  return (
    <WelcomeFrame leftside={leftside} pathName="/select-initial-plan">
      <Flex direction="column" gap="4" style={{ maxWidth: "600px" }}>
        <Heading as="h1">Plan Options</Heading>
        <RadioCards
          options={[
            {
              value: "starter",
              label: (
                <Flex direction="row" align="center" justify="between" gap="2">
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
                    <li>1M CDN Requests/month included</li>
                    <li>5GB Bandwidth/month included</li>
                  </ul>
                </Flex>
              ),
            },
            {
              value: "pro",
              label: (
                <Flex direction="row" align="center" justify="between" gap="2">
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
                    <li>2M CDN Requests/month included</li>
                    <li>20GB Bandwidth/month included</li>
                  </ul>
                </Flex>
              ),
            },
          ]}
          value={plan}
          align="start"
          setValue={(v) => setPlan(v as PlanChoice)}
          columns="2"
          width="100%"
        />
        <div className="d-flex gap-2">
          <Button
            color="primary"
            onClick={plan === "starter" ? handleStarter : handleProContinue}
            disabled={loading}
          >
            {plan === "starter"
              ? "Get Started for Free"
              : "Get Started with Pro"}
          </Button>
        </div>
        {error && <div className="alert alert-danger mt-3">{error}</div>}
      </Flex>
    </WelcomeFrame>
  );
};

type ProBillingStepProps = {
  initialData: ProBillingData | null;
  defaultEmail: string;
  onNext: (data: ProBillingData) => void;
  onBack: () => void;
  setError: (v: string | null) => void;
};

const ProBillingStep: FC<ProBillingStepProps> = ({
  initialData,
  defaultEmail,
  onNext,
  onBack,
  setError,
}) => {
  const form = useForm<ProBillingData>({
    defaultValues: {
      email: initialData?.email ?? defaultEmail,
      taxIdType: initialData?.taxIdType,
      taxIdValue: initialData?.taxIdValue,
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        email: initialData.email,
        taxIdType: initialData.taxIdType,
        taxIdValue: initialData.taxIdValue,
      });
    }
  }, [initialData, form]);

  const handleNext = () => {
    setError(null);
    form.handleSubmit((data) => onNext(data))();
  };

  return (
    <div style={{ maxWidth: "500px" }}>
      <Heading as="h2" className="mb-3">
        Billing details
      </Heading>
      <Text color="gray" className="mb-4" as="p">
        Enter your billing information. You&apos;ll add a payment method on the
        next step.
      </Text>
      <div className="mb-4">
        <Field
          type="email"
          required={true}
          label="Billing email"
          {...form.register("email", { required: true })}
        />
        <Text size="1" color="gray" as="p" className="mt-1">
          Monthly invoices will be sent to this address
        </Text>
      </div>
      <Flex gap="4" mb="4">
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
      <Flex gap="2" className="mt-4">
        <Button color="primary" onClick={handleNext}>
          Next: Add payment method
        </Button>
        <Button color="secondary" onClick={onBack}>
          Back to plan selection
        </Button>
      </Flex>
    </div>
  );
};

type ProSetupStepProps = {
  onClientSecret: (secret: string) => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
};

const ProSetupStep: FC<ProSetupStepProps> = ({
  onClientSecret,
  setLoading,
  setError,
}) => {
  const { apiCall } = useAuth();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiCall<{ clientSecret: string }>("/subscription/setup-intent", {
      method: "POST",
    })
      .then((res) => {
        if (!cancelled && res?.clientSecret) {
          onClientSecret(res.clientSecret);
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
  }, [apiCall, onClientSecret, setLoading, setError]);

  return <LoadingOverlay />;
};

type ProPaymentFormProps = {
  clientSecret: string;
  billingData: ProBillingData;
  onSuccess: () => void;
  onCompleteFlow: () => void;
  onBack: () => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
};

const ProPaymentFormInner: FC<ProPaymentFormProps> = ({
  billingData,
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
      <Heading as="h2" className="mb-3">
        Add payment method
      </Heading>
      <div className="mb-4">
        <PaymentElement />
        <p className="pt-3 text-muted" style={{ fontSize: "14px" }}>
          The cost is <strong>$40 per seat per month</strong>. You will be
          charged a pro-rated amount immediately for the remainder of the
          current month. Cancel anytime.
        </p>
      </div>
      <div className="mb-4">
        <Checkbox
          label="Customize Invoice"
          value={showAddress}
          setValue={setShowAddress}
          description="Add a full billing address and optionally customize the name displayed on invoices."
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
      <Flex gap="2">
        <Button color="primary" onClick={handleSubmit}>
          Start subscription
        </Button>
        <Button color="secondary" onClick={onBack}>
          Back
        </Button>
      </Flex>
    </div>
  );
};

const ProPaymentForm: FC<ProPaymentFormProps> = (props) => {
  return (
    <StripeProvider initialClientSecret={props.clientSecret}>
      <ProPaymentFormInner {...props} />
    </StripeProvider>
  );
};

export default SelectInitialPlan;
