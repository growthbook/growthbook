import { useEffect, useState } from "react";
import { useUser } from "../../../services/UserContext";
import { useForm } from "react-hook-form";
import fetch from "node-fetch";
import track from "../../../services/track";
import Field from "../../Forms/Field";
import LoadingSpinner from "../../LoadingSpinner";
import { FaExclamationTriangle, FaRegCheckCircle } from "react-icons/fa";

const LICENSE_KEY_API_URL = "https://license.growthbook.io/api/trial/";

export default function SelfHostedUpgradeForm({
  source,
  setCloseCta,
  close,
}: {
  source: string;
  setCloseCta: (string) => void;
  close: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [submitState, setSubmitState] = useState(false);

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
        <p className="text-center mb-4" style={{ fontSize: "1.5em" }}>
          Try GrowthBook Enterprise for free
        </p>
        <p className="text-center mt-2 mb-1">
          Try our <strong>Enterprise</strong> plan for self-hosted accounts for{" "}
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
        {error && (
          <div className="alert alert-danger mt-4">{error}</div>
        )}

        {submitState && (
          <>
          <div className="alert alert-success mt-4">
            <FaRegCheckCircle /> Thank you for requesting an Enterprise trial license. Please check
            your email for next steps.
          </div>
          <div className="appbox px-4 py-2" style={{ fontSize: 12 }}>
            <FaExclamationTriangle /> Didn&apos;t receive an email? Check your spam folder for messages
            from <em>sales@growthbook.io</em>. Or contact us at{" "}
            <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>
          </div>
          </>
        )}

        { !submitState && (
          <form
            style={{ opacity: submitState ? 0.5 : 1 }}
            onSubmit={form.handleSubmit(async (value) => {
              if (loading) return;
              setError(null);
              setLoading(true);
              try {
                const encodedParams = new URLSearchParams();
                for (const key in value) {
                  encodedParams.append(key, value[key]);
                }
                const resp = await fetch(LICENSE_KEY_API_URL, {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: encodedParams,
                });
                if (resp?.status === 200) {
                  setSubmitState(true);
                  setLoading(false);
                  setCloseCta("Close");
                  track("Generate trial license", {
                    source,
                    accountPlan,
                    ...value,
                  });
                } else {
                  setLoading(false);
                  const txt = await resp.text();
                  switch (txt) {
                    case "active license exists":
                      setError(
                        "You already have an active license key. Please check your email, or contact us at sales@growthbook.io."
                      );
                      break;
                    case "expired license exists":
                      setError(
                        "Your license key has already expired. Please contact us at sales@growthbook.io for more information."
                      );
                      break;
                    default:
                      setError(
                        <>
                          <p className="mb-2">
                            There was a server error. Please try again later, or
                            contact us at sales@growthbook.io.
                          </p>
                          <p className="mb-0">{txt}</p>
                        </>
                      );
                  }
                }
              } catch (e) {
                setLoading(false);
                setError(e.message);
              }
            })}
          >
            <Field
              required
              label="Your name"
              {...form.register("name")}
              disabled={loading || submitState}
            />
            <Field
              required
              label="Email Address"
              {...form.register("email")}
              type="email"
              disabled={loading || submitState}
            />

            <button
              className="mt-4 btn btn-primary btn-block btn-lg"
              type="submit"
              disabled={loading || submitState}
            >
              {loading
                ? <><LoadingSpinner /> Please wait...</>
                : submitState
                ? `Thank you`
                : `Send me a license key`}
            </button>
          </form>
        )}
        { submitState && (
          <button
            className="mt-4 btn btn-primary btn-block btn-lg"
            type="submit"
            onClick={close}
          >
            Close
          </button>
        )}

        <p className="mt-3">
          Contact <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>{" "}
          with any additional questions.
        </p>
      </div>
    </>
  );
}
