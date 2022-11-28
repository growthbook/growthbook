import Link from "next/link";
import { FC, useState } from "react";
import { FaAngleLeft } from "react-icons/fa";
import { isCloud } from "../../services/env";
import { useUser } from "../../services/UserContext";
import Field from "../../components/Forms/Field";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import fetch from "node-fetch";

const TryEnterprisePage: FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [submitState, setSubmitState] = useState(null);

  const { accountPlan, name, email, organization } = useUser();

  const form = useForm({
    defaultValues: {
      name,
      email,
      seats: 5,
      companyName: organization?.name,
      organizationId: organization?.id,
      plan: "pro",
    },
  });

  if (isCloud()) {
    return (
      <div className="alert alert-info">
        This page is only available for self-hosted installations.
      </div>
    );
  }
  if (!isCloud() && accountPlan !== "oss") {
    return (
      <div className="alert alert-info">
        You already have a premium account plan.
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Try GrowthBook Pro</h1>
      <div className=" bg-white p-3 border">
        <div>
          <p>Try GrowthBook Pro for self-hosted accounts for 3 months free!</p>
          <p>
            Submit the form below and we&apos;ll send you a trial license key
            via email.
          </p>
        </div>

        {error && (
          <div className="row">
            <div className="col-md-6">
              <div className="alert alert-danger mr-auto">{error}</div>
            </div>
          </div>
        )}

        {submitState && (
          <div className="row">
            <div className="col-md-6">
              <div className="alert alert-info mr-auto">
                <p>
                  Thank you for requesting a Pro trial license. Please check
                  your email for next steps.
                </p>
                <p className="mb-0">
                  Didn&apos;t receive an email? Check your spam folder for
                  messages from <em>growthbook.io</em>. Or contact us at{" "}
                  <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>
                </p>
              </div>
            </div>
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
              track("Generate trial license", value);
            } catch (e) {
              setLoading(false);
              setError(e.message);
            }
          })}
        >
          <div className="row">
            <div className="col-md-6">
              <Field required label="Your name" {...form.register("name")} />
            </div>
          </div>
          <div className="row">
            <div className="col-md-6">
              <Field
                required
                label="Email Address"
                {...form.register("email")}
                type="email"
              />
            </div>
          </div>
          <div className="row">
            <div className="col-md-6">
              <Field
                required
                label="Plan type"
                {...form.register("plan")}
                options={[
                  { display: "Enterprise", value: "enterprise" },
                  { display: "Pro", value: "pro" },
                  { display: "Pro with SSO", value: "pro_sso" },
                ]}
                type="options"
              />
            </div>
          </div>
          <div className="row">
            <div className="col-md-6">
              <Field
                required
                label="Number of seats"
                {...form.register("seats", { valueAsNumber: true })}
                type="number"
                min="3"
                max="10"
                step="1"
              />
            </div>
          </div>

          <div className="row">
            <div className="col-md-6">
              <button
                className="btn btn-primary btn-block btn-lg"
                type="submit"
                disabled={loading}
              >
                Send trial license
              </button>
            </div>
          </div>
        </form>

        <p className="mt-3">
          Contact <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>{" "}
          with any additional questions.
        </p>
      </div>
    </div>
  );
};
export default TryEnterprisePage;
