import { useEffect, useState } from "react";
import { useUser } from "../../../services/UserContext";
import { useForm } from "react-hook-form";
import fetch from "node-fetch";
import track from "../../../services/track";
import Field from "../../Forms/Field";

export default function SelfHostedUpgradeForm({
  source,
  reason,
}: {
  source: string;
  reason: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [submitState, setSubmitState] = useState(null);

  const { accountPlan, name, email, organization } = useUser();

  useEffect(() => {
    track("View Upgrade Modal", {
      accountPlan,
      source,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const form = useForm({
    defaultValues: {
      name,
      email,
      seats: Math.max(organization?.members?.length || 10, 10),
      companyName: organization?.name,
      organizationId: organization?.id,
      plan: "pro",
    },
  });

  return (
    <>
      <div className="text-center mb-2">
        <p className="text-center mb-1" style={{ fontSize: "1.3em" }}>
          {reason} Try a premium GrowthBook plan for free
        </p>
        <p className="text-center mt-2 mb-1">
          Try <strong>Pro</strong>, <strong>Pro + SSO</strong>, or{" "}
          <strong>Enterprise</strong> for self-hosted accounts for{" "}
          <em>3 months free</em>!
        </p>
        <p>
          Complete the form below and we&apos;ll email you a trial license key.
        </p>
        <div
          className="text-center appbox py-2 px-4 m-auto"
          style={{ maxWidth: "50%" }}
        >
          <p className="mb-1">Interested in a Cloud-based plan instead?</p>
          <p className="mb-0">
            Visit our{" "}
            <a
              href="https://www.growthbook.io/pricing"
              target="_blank"
              onClick={() => {
                track("Click Cloud pricing link", {
                  accountPlan,
                  source,
                });
              }}
              rel="noreferrer"
            >
              Cloud pricing page
            </a>
            . Or contact us at{" "}
            <a
              href="mailto:sales@growthbook.io"
              onClick={() => {
                track("Click Cloud custom quote email", {
                  accountPlan,
                  source,
                });
              }}
            >
              sales@growthbook.io
            </a>{" "}
            for a custom quote.
          </p>
        </div>
      </div>
      <div className="m-auto" style={{ maxWidth: "65%" }}>
        {error && <div className="alert alert-danger mr-auto">{error}</div>}

        {submitState && (
          <div className="alert alert-info mr-auto">
            <p>
              Thank you for requesting a Pro trial license. Please check your
              email for next steps.
            </p>
            <p className="mb-0">
              Didn&apos;t receive an email? Check your spam folder for messages
              from <em>growthbook.io</em>. Or contact us at{" "}
              <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>
            </p>
          </div>
        )}

        <form
          onSubmit={form.handleSubmit(async (value) => {
            if (loading) return;
            setError(null);
            setLoading(true);
            try {
              await fetch(
                "https://cdn.growthbook.io/trial-license?" +
                  new URLSearchParams({
                    name: value.name,
                    email: value.email,
                    seats: value.seats + "",
                    companyName: value.companyName,
                    organizationId: value.organizationId,
                    plan: value.plan,
                  }),
                { method: "GET" }
              );
              setSubmitState(true);
              setLoading(false);
              track("Generate trial license", {
                source,
                accountPlan,
                ...value,
              });
            } catch (e) {
              setLoading(false);
              setError(e.message);
            }
          })}
        >
          <Field required label="Your name" {...form.register("name")} />
          <Field
            required
            label="Email Address"
            {...form.register("email")}
            type="email"
          />
          <Field
            required
            label="Plan type"
            {...form.register("plan")}
            options={[
              { display: "Enterprise", value: "enterprise" },
              { display: "Pro", value: "pro" },
              { display: "Pro + SSO", value: "pro_sso" },
            ]}
            type="options"
          />
          <Field
            required
            label="Number of seats"
            {...form.register("seats", { valueAsNumber: true })}
            type="number"
            min="3"
            max="999"
            step="1"
            pattern="\d*"
          />

          <button
            className="mt-4 btn btn-primary btn-block btn-lg"
            type="submit"
            disabled={loading}
          >
            Send me a license key
          </button>
        </form>

        <p className="mt-3">
          Contact <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>{" "}
          with any additional questions.
        </p>
      </div>
    </>
  );
}
