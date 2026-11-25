import { useState } from "react";
import { useForm } from "react-hook-form";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import Field from "@/components/Forms/Field";
import { redirectWithTimeout, safeLogout } from "@/services/auth";
import { getApiHost, isCloud } from "@/services/env";
import WelcomeFrame from "@/components/Auth/WelcomeFrame";
import Callout from "@/ui/Callout";

export async function lookupByEmail(email: string, i18n: I18n) {
  if (!isCloud()) {
    throw new Error(i18n._(msg`Only available on GrowthBook Cloud`));
  }

  const domain = email.split("@")[1];
  if (!domain) {
    throw new Error(i18n._(msg`Please enter a valid email address`));
  }
  const res = await window.fetch(`${getApiHost()}/auth/sso`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      domain,
    }),
  });
  const json: { message?: string; status: number } = await res.json();
  if (json.message || json.status !== 200) {
    throw new Error(
      json?.message ||
        i18n._(msg`No SSO Connection found for that email address.`),
    );
  }
}

export default function OAuthLookup() {
  const { t, i18n } = useLingui();
  const form = useForm({
    defaultValues: {
      email: "",
    },
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const leftside = (
    <>
      <h1 className="title h1">GrowthBook Enterprise</h1>
      <p></p>
    </>
  );
  return (
    <WelcomeFrame
      leftside={leftside}
      loading={loading}
      pathName="/oauth/lookup"
    >
      <form
        onSubmit={form.handleSubmit(async ({ email }) => {
          try {
            setLoading(true);
            // This will lookup the SSO config id and store it in a cookie
            await lookupByEmail(email, i18n);
            await redirectWithTimeout(window.location.origin);
            setLoading(false);
          } catch (e) {
            setError(e.message);
            setLoading(false);
          }
        })}
      >
        <div>
          <h3 className="h2">
            <Trans>Enterprise SSO Login</Trans>
          </h3>
          <p>
            <Trans>
              Enter your email address and you will be redirected to your
              company&apos;s SSO portal, if configured.
            </Trans>
          </p>
        </div>
        <Field
          size="legacy"
          required
          label={t`Email Address`}
          {...form.register("email")}
          type="email"
          autoFocus={true}
          autoComplete="username"
        />
        {error && <Callout status="error">{error}</Callout>}
        <button className={`btn btn-primary btn-block btn-lg`} type="submit">
          <Trans>Continue</Trans>
        </button>
      </form>
      <div className="text-center mt-3">
        <p>
          <Trans>
            Not using SSO?{" "}
            <a
              href="#"
              onClick={async (e) => {
                e.preventDefault();
                setLoading(true);
                await safeLogout();
              }}
            >
              Go back to login
            </a>
          </Trans>
        </p>
        <div>
          <br />
          <Trans>
            Don&apos;t have a GrowthBook Enterprise plan yet?
            <br />
            Email <a href="mailto:sales@growthbook.io">
              sales@growthbook.io
            </a>{" "}
            to learn more and get a quote.
          </Trans>
        </div>
      </div>
    </WelcomeFrame>
  );
}

// Skip the normal authentication flow
OAuthLookup.preAuth = true;
