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
import { Trans, useLingui } from "@lingui/react/macro";
import { TaxIdType, StripeAddress } from "shared/types/subscriptions";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { StripeProvider } from "@/enterprise/components/Billing/StripeProvider";
import { useStripeContext } from "@/hooks/useStripeContext";
import { useForceLicenseRefresh } from "@/hooks/useForceLicenseRefresh";
import { taxIdTypeOptions } from "@/enterprise/components/Billing/CloudProUpgradeModal";
import RadioCards from "@/ui/RadioCards";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";
import Checkbox from "@/ui/Checkbox";
import UIButton from "@/ui/Button";
import Button from "@/components/Button";
import track from "@/services/track";
import Callout from "@/ui/Callout";
import WelcomeFrame from "./WelcomeFrame";

export type InitialPlanOptions = "" | "starter" | "pro";

const leftside = (
  <Flex direction="column" justify="between" height="100%" p="6">
    <Box>
      <a href="https://www.growthbook.io" target="_blank" rel="noreferrer">
        <img
          src="/logo/growth-book-logo-white.svg"
          style={{ maxWidth: "150px" }}
          alt="GrowthBook"
        />
      </a>
    </Box>
    <Box>
      <h1 className="title h1">
        <Trans>Confirm your plan</Trans>
      </h1>
      <p>
        <Trans>You can change this later in your account settings.</Trans>
      </p>
    </Box>
  </Flex>
);
type ProBillingData = {
  email: string;
  taxIdType?: TaxIdType;
  taxIdValue?: string;
};

const SelectInitialPlan: FC = () => {
  const { t } = useLingui();
  const router = useRouter();
  const {
    initialPlanSelection,
    setInitialPlanSelection,
    initialPlanFromUrl,
    organizations,
    orgId,
    setOrgId,
  } = useAuth();
  const urlPlan = initialPlanFromUrl ?? "";
  const { email } = useUser();
  const {
    status: organizationRefreshStatus,
    refresh: refreshOrganizationAfterUpgrade,
    retry: retryOrganizationRefresh,
  } = useForceLicenseRefresh();
  const organizationRefreshFailed = organizationRefreshStatus !== "idle";
  const plan: InitialPlanOptions =
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

  useEffect(() => {
    track("Initial signup: viewed plan selection", { urlPlan });
  }, [urlPlan]);

  const completeFlow = useCallback(() => {
    track("Initial signup: flow completed", { plan, urlPlan });
    setInitialPlanSelection?.("");
    router.push("/");
  }, [plan, urlPlan, router, setInitialPlanSelection]);

  const handleDismiss = useCallback(() => {
    track("Initial signup: dismissed plan selection", { plan, urlPlan });
    setInitialPlanSelection?.("");
    router.push("/");
  }, [plan, urlPlan, router, setInitialPlanSelection]);

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
          {organizations && organizations.length > 1 && (
            <SelectField
              label={t`Organization`}
              value={orgId ?? ""}
              options={(organizations ?? []).map((o) => ({
                label: o.name,
                value: o.id,
              }))}
              onChange={(id) => {
                setOrgId?.(id);
                try {
                  localStorage.setItem("gb-last-picked-org", `"${id}"`);
                } catch (e) {
                  // ignore
                }
              }}
            />
          )}
          <Heading as="h1">
            <Trans>Plan options</Trans>
          </Heading>
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
                    <Heading as="h2" size="sm">
                      Starter
                    </Heading>
                    <Text color="text-low">
                      <Trans>Free</Trans>
                    </Text>
                  </Flex>
                ),
                description: (
                  <Flex direction="column" gap="3" className="mt-3">
                    <Text color="text-low">
                      <Trans>
                        Basic flags and experiments for solo devs and small
                        teams
                      </Trans>
                    </Text>
                    <ul
                      style={{
                        paddingLeft: 0,
                        marginLeft: 0,
                        listStylePosition: "inside",
                      }}
                    >
                      <li>
                        <Trans>Unlimited feature flags</Trans>
                      </li>
                      <li>
                        <Trans>Unlimited experiments</Trans>
                      </li>
                      <li>
                        <Trans>Add up to 3 seats</Trans>
                      </li>
                      <li>
                        <Trans>1M CDN Requests/month</Trans>
                      </li>
                      <li>
                        <Trans>5GB Bandwidth/month</Trans>
                      </li>
                    </ul>
                    <Button
                      color="primary"
                      onClick={() => {
                        track("Initial signup: selected Starter plan", {
                          urlPlan,
                        });
                        handleStarter();
                      }}
                      disabled={loading || plan !== "starter"}
                    >
                      <Trans>Get Started for Free</Trans>
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
                    <Heading as="h2" size="sm">
                      Pro
                    </Heading>
                    <Text color="text-low">
                      <Trans>Starts at $40/month</Trans>
                    </Text>
                  </Flex>
                ),
                description: (
                  <Flex direction="column" gap="3" className="mt-3">
                    <Text color="text-low">
                      <Trans>
                        Full featured experimentation and growth platform
                      </Trans>
                    </Text>
                    <ul
                      style={{
                        paddingLeft: 0,
                        marginLeft: 0,
                        listStylePosition: "inside",
                      }}
                    >
                      <li>
                        <Trans>Advanced statistics</Trans>
                      </li>
                      <li>
                        <Trans>Add up to 50 seats</Trans>
                      </li>
                      <li>
                        <Trans>Advanced permissions</Trans>
                      </li>
                      <li>
                        <Trans>2M CDN Requests/month</Trans>
                      </li>
                      <li>
                        <Trans>20GB Bandwidth/month</Trans>
                      </li>
                    </ul>
                    <Button
                      color="primary"
                      onClick={() => {
                        track("Initial signup: selected Pro plan", {
                          urlPlan,
                        });
                        handleNext();
                      }}
                      disabled={loading || plan !== "pro"}
                    >
                      <Trans>Next: Add Payment Details</Trans>
                    </Button>
                  </Flex>
                ),
              },
            ]}
            value={plan}
            align="start"
            setValue={(v) => setPlan(v as InitialPlanOptions)}
            columns="2"
            width="100%"
          />
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
          error={error}
          getBillingData={() => billingForm.getValues()}
          onSuccess={() => handleNext()}
          onBack={handleBack}
          setLoading={setLoading}
          setError={setError}
          refreshOrganizationAfterUpgrade={refreshOrganizationAfterUpgrade}
        />
      )}
      {step >= 4 && (
        <div style={{ maxWidth: "500px" }}>
          <h2 className="h3 mb-1">
            {organizationRefreshFailed ? (
              <Trans>GrowthBook Pro Subscription Created</Trans>
            ) : (
              <Trans>Welcome to GrowthBook Pro!</Trans>
            )}
          </h2>
          {!organizationRefreshFailed && (
            <p className="text-muted mb-3">
              <Trans>
                You&apos;re all set! Go to your GrowthBook dashboard to start
                your setup.
              </Trans>
            </p>
          )}
          {organizationRefreshFailed && (
            <Callout
              status="warning"
              mt="3"
              action={
                <UIButton
                  size="sm"
                  color="inherit"
                  loading={organizationRefreshStatus === "loading"}
                  onClick={retryOrganizationRefresh}
                >
                  <Trans>Try again</Trans>
                </UIButton>
              }
            >
              <Trans>
                We couldn&apos;t refresh your organization details. Try again to
                see your updated plan.
              </Trans>
            </Callout>
          )}
          <Button
            color="primary"
            onClick={completeFlow}
            disabled={loading || organizationRefreshStatus === "loading"}
          >
            <Trans>Get started</Trans>
          </Button>
        </div>
      )}
      {error && (
        <Callout status="error" role="alert" mt="3">
          {error}
        </Callout>
      )}
      <Flex align="center" justify="center" mt="3">
        <Text size="md" color="text-low">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleDismiss();
            }}
          >
            <Trans>Skip plan selection</Trans>
          </a>
        </Text>
      </Flex>
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
  const { t } = useLingui();
  const { initialPlanFromUrl } = useAuth();
  const handleNext = () => {
    setError(null);
    form.handleSubmit(() => onNext())();
  };

  return (
    <div>
      <Heading as="h2" mb="1">
        <Trans>Billing details</Trans>
      </Heading>
      <Text color="text-low" mb="4" as="p">
        <Trans>
          Enter your billing information. You can add your payment method next.
        </Trans>
      </Text>
      <Field
        size="legacy"
        type="email"
        required={true}
        label={t`Billing email`}
        helpText={t`Monthly invoices will be sent to this address`}
        {...form.register("email", { required: true })}
      />
      <Flex gap="4">
        <Box style={{ flex: 1 }}>
          <SelectField
            size="legacy"
            label={t`Tax ID type`}
            options={taxIdTypeOptions}
            value={form.watch("taxIdType") || ""}
            placeholder={t`(optional)`}
            onChange={(value) => form.setValue("taxIdType", value as TaxIdType)}
            isClearable={true}
          />
        </Box>
        <Box style={{ flex: 1 }}>
          <Field
            size="legacy"
            type="text"
            {...form.register("taxIdValue")}
            placeholder={t`(optional)`}
            label={
              <Flex align="center">
                <span className="mr-1">
                  <Trans>Tax ID</Trans>
                </span>
                <Tooltip body={t`Enter your tax id here. E.G. VAT or EIN`}>
                  <GBInfo />
                </Tooltip>
              </Flex>
            }
          />
        </Box>
      </Flex>
      <Flex width="100%" justify="between">
        <Button color="secondary" onClick={onBack}>
          <Trans>Back</Trans>
        </Button>
        <Button
          color="primary"
          onClick={() => {
            track("Initial signup: submitted tax details", {
              urlPlan: initialPlanFromUrl ?? "",
            });
            handleNext();
          }}
        >
          <Trans>Next</Trans>
        </Button>
      </Flex>
    </div>
  );
};

type ProPaymentStepProps = {
  error: string | null;
  getBillingData: () => ProBillingData;
  onSuccess: () => void;
  onBack: () => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  refreshOrganizationAfterUpgrade: () => Promise<void>;
};

const ProPaymentStep: FC<ProPaymentStepProps> = ({
  error,
  getBillingData,
  onSuccess,
  onBack,
  setLoading,
  setError,
  refreshOrganizationAfterUpgrade,
}) => {
  // StripeProvider now owns the load-Stripe-then-create-Radar-session-then-
  // fetch-SetupIntent flow, so this component just renders it directly.
  return (
    <StripeProvider setupIntentEndpoint="/subscription/setup-intent">
      <ProPaymentFormInner
        getBillingData={getBillingData}
        onSuccess={onSuccess}
        onBack={onBack}
        setLoading={setLoading}
        setError={setError}
        error={error}
        refreshOrganizationAfterUpgrade={refreshOrganizationAfterUpgrade}
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
  error: string | null;
  refreshOrganizationAfterUpgrade: () => Promise<void>;
};

const ProPaymentFormInner: FC<ProPaymentFormProps> = ({
  getBillingData,
  onSuccess,
  onBack,
  setLoading,
  setError,
  error,
  refreshOrganizationAfterUpgrade,
}) => {
  const { t } = useLingui();
  const { apiCall, initialPlanFromUrl } = useAuth();
  const urlPlan = initialPlanFromUrl ?? "";
  const { organization } = useUser();
  const stripe = useStripe();
  const elements = useElements();
  const { clientSecret } = useStripeContext();
  const [showAddress, setShowAddress] = useState(false);
  const form = useForm<{ name: string; address?: StripeAddress }>({
    defaultValues: { name: organization?.name || "" },
  });

  const handleSubmit = async () => {
    track("Initial signup: submitted payment method", { urlPlan });
    if (!stripe || !elements || !clientSecret) return;
    setError(null);
    setLoading(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(
          submitError.message || t`Unable to validate payment method inputs`,
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
      const { setupIntent, error: setupIntentError } =
        await stripe.confirmSetup({
          elements,
          clientSecret,
          redirect: "if_required",
        });

      if (setupIntentError) {
        throw new Error(setupIntentError.message);
      }

      if (!setupIntent || !setupIntent.payment_method) {
        throw new Error(t`Unable to save new payment method`);
      }

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
      track("Pro subscription started", {
        flow: "initial-signup",
        seats: organization?.members?.length ?? 0,
        urlPlan,
      });
    } catch (e) {
      setLoading(false);
      const message = e instanceof Error ? e.message : t`Something went wrong`;
      setError(message);
      return;
    }

    await refreshOrganizationAfterUpgrade();
    setLoading(false);
    onSuccess();
  };

  return (
    <div style={{ maxWidth: "500px" }}>
      <Heading as="h2" mb="3">
        <Trans>Add payment method</Trans>
      </Heading>
      <div className="mb-4">
        <PaymentElement />
        <p className="pt-3 text-muted" style={{ fontSize: "14px" }}>
          <Trans>
            You will be charged a pro-rated amount for the remainder of this
            month, and $40 per month per seat thereafter. Cancel anytime.
          </Trans>
        </p>
      </div>
      <div className="mb-4">
        <Checkbox
          label={t`Customize invoice`}
          value={showAddress}
          setValue={setShowAddress}
          description={t`Add a billing address and customize the name displayed on invoices.`}
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
          <Trans>Back</Trans>
        </Button>
        <Button color="primary" onClick={handleSubmit}>
          {error ? <Trans>Retry</Trans> : <Trans>Next</Trans>}
        </Button>
      </Flex>
    </div>
  );
};

export default SelectInitialPlan;
