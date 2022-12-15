import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import fetch from "node-fetch";
import { FaExclamationTriangle, FaRegCheckCircle } from "react-icons/fa";
import { useUser } from "../../../services/UserContext";
import track from "../../../services/track";
import Field from "../../Forms/Field";
import LoadingSpinner from "../../LoadingSpinner";
import { getNumberOfUniqueMembersAndInvites } from "../../../services/organizations";
import { getGrowthBookBuild } from "../../../services/env";

const LICENSE_KEY_API_URL = "https://license.growthbook.io/api";

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
  const [submitState, setSubmitState] = useState<
    false | "send key success" | "resend success" | "resend failed"
  >(false);
  const [useResendForm, setUseResendForm] = useState(false);

  const { accountPlan, name, email, organization } = useUser();

  const seats = getNumberOfUniqueMembersAndInvites(organization);
  const trackContext = {
    accountPlan,
    source,
    seats,
  };
  const customerContext = {
    organizationCreated: organization.dateCreated,
    currentSeats: getNumberOfUniqueMembersAndInvites(organization),
    currentPlan: accountPlan,
    currentBuild: getGrowthBookBuild(),
    ctaSource: source,
  };

  useEffect(() => {
    track("View Upgrade Modal", trackContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const form = useForm({
    defaultValues: {
      companyName: organization?.name,
      organizationId: organization?.id,
      name,
      email,
      context: customerContext,
    },
  });

  const submitMainForm = form.handleSubmit(async (value) => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch(`${LICENSE_KEY_API_URL}/trial`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: JSON.stringify(value),
      });
      if (resp?.status === 200) {
        setSubmitState("send key success");
        setLoading(false);
        setCloseCta("Close");
        track("Generate trial license", trackContext);
      } else {
        setLoading(false);
        const txt = await resp.text();
        switch (txt) {
          case "active license exists":
            setError(
              "You already have an active license key. Please check your email, or click below to resend the key to your email address. Contact us at sales@growthbook.io for more information."
            );
            setUseResendForm(true);
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
                  There was a server error. Please try again later, or contact
                  us at sales@growthbook.io.
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
                track("Click Cloud Pricing Link", trackContext);
              }}
              rel="noreferrer"
            >
              Cloud pricing page
            </a>
            . Or contact us at{" "}
            <a
              href="mailto:sales@growthbook.io"
              onClick={() => {
                track("Click Cloud Custom Quote Email", trackContext);
              }}
            >
              sales@growthbook.io
            </a>{" "}
            for a custom quote.
          </p>
        </div>
      </div>

      <div className="m-auto" style={{ maxWidth: "65%" }}>
        {error && <div className="alert alert-danger mt-4">{error}</div>}

        {submitState === "send key success" && (
          <>
            <div className="alert alert-success mt-4">
              <FaRegCheckCircle /> Thank you for requesting an Enterprise trial
              license. Please check your email for next steps.
            </div>
            <div className="appbox px-4 py-2" style={{ fontSize: 12 }}>
              <FaExclamationTriangle /> Didn&apos;t receive an email? Check your
              spam folder for messages from <em>sales@growthbook.io</em>. Or
              contact us at{" "}
              <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>
            </div>
          </>
        )}
        {submitState === "resend success" && (
          <div className="alert alert-info mt-4">
            Your trial license has been resent to the email address first used
            to request it.
          </div>
        )}

        {!useResendForm && !submitState && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await submitMainForm();
            }}
          >
            <Field
              required
              label="Your name"
              {...form.register("name")}
              disabled={loading || !!submitState}
            />
            <Field
              required
              label="Email Address"
              {...form.register("email")}
              type="email"
              disabled={loading || !!submitState}
            />

            <button
              className="mt-4 btn btn-primary btn-block btn-lg"
              type="submit"
              disabled={loading || !!submitState}
            >
              {loading ? (
                <>
                  <LoadingSpinner /> Please wait...
                </>
              ) : (
                `Send me a license key`
              )}
            </button>
          </form>
        )}

        {useResendForm && !submitState && (
          <button
            className="mt-4 btn btn-primary btn-block btn-lg"
            type="button"
            disabled={loading || !!submitState}
            onClick={async () => {
              setSubmitState(false);
              setLoading(true);
              try {
                const resp = await fetch(
                  `${LICENSE_KEY_API_URL}/resendKey?org=${organization?.id}`,
                  {
                    method: "GET",
                  }
                );
                if (resp?.status === 200) {
                  setSubmitState("resend success");
                  setError(null);
                  setLoading(false);
                } else {
                  setLoading(false);
                  const txt = await resp.text();
                  setError(txt);
                  setSubmitState("resend failed");
                }
              } catch (e) {
                setLoading(false);
                setError(e.message);
                setSubmitState(false);
              }
            }}
          >
            {loading ? (
              <>
                <LoadingSpinner /> Please wait...
              </>
            ) : (
              `Resend my license key`
            )}
          </button>
        )}
        {submitState && (
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
