import { useState } from "react";
import { useForm } from "react-hook-form";
import Field from "@/components/Forms/Field";
import { redirectWithTimeout, safeLogout } from "@/services/auth";
import { getApiHost, isCloud } from "@/services/env";
import WelcomeFrame from "@/components/Auth/WelcomeFrame";

export async function lookupByEmail(email: string) {
  if (!isCloud()) {
    throw new Error("Only available on GrowthBook Cloud");
  }

  const domain = email.split("@")[1];
  if (!domain) {
    throw new Error("Please enter a valid email address");
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
      json?.message || "No SSO Connection found for that email address."
    );
  }
}

export default function OAuthLookup() {
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
    <WelcomeFrame leftside={leftside} loading={loading}>
      <form
        onSubmit={form.handleSubmit(async ({ email }) => {
          try {
            setLoading(true);
            // This will lookup the SSO config id and store it in a cookie
            await lookupByEmail(email);
            await redirectWithTimeout(window.location.origin);
            setLoading(false);
          } catch (e) {
            setError(e.message);
            setLoading(false);
          }
        })}
      >
        <div>
          <h3 className="h2">Enterprise SSO Login</h3>
          <p>
            Enter your email address and you will be redirected to your
            company&apos;s SSO portal, if configured.
          </p>
        </div>
        <Field
          required
          label="Email Address"
          {...form.register("email")}
          type="email"
          autoFocus={true}
          autoComplete="username"
        />
        {error && <div className="alert alert-danger mr-auto">{error}</div>}
        <button className={`btn btn-primary btn-block btn-lg`} type="submit">
          Continue
        </button>
      </form>
      <div className="text-center mt-3">
        <p>
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
        </p>
        <div>
          <br />
          Don&apos;t have a GrowthBook Enterprise plan yet?
          <br />
          Email <a href="mailto:sales@growthbook.io">sales@growthbook.io</a> to
          learn more and get a quote.
        </div>
      </div>
    </WelcomeFrame>
  );
}

// Skip the normal authentication flow
OAuthLookup.preAuth = true;
