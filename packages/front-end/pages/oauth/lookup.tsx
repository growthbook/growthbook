import { useState } from "react";
import { useForm } from "react-hook-form";
import Field from "../../components/Forms/Field";
import LoadingOverlay from "../../components/LoadingOverlay";
import Modal from "../../components/Modal";
import { redirectWithTimeout, softLogout } from "../../services/auth";
import { getApiHost, isCloud } from "../../services/env";

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

  const [open, setOpen] = useState(true);

  if (!open) {
    return <LoadingOverlay />;
  }

  return (
    <Modal
      open={true}
      autoCloseOnSubmit={false}
      submit={form.handleSubmit(async ({ email }) => {
        // This will lookup the SSO config id and store it in a cookie
        await lookupByEmail(email);
        await redirectWithTimeout(window.location.origin);
      })}
      close={async () => {
        setOpen(false);
        await softLogout();
        await redirectWithTimeout(window.location.origin);
      }}
      closeCta="Cancel"
      cta="Continue"
    >
      <h3>Enterprise SSO Login</h3>
      <p>
        Enter your email address and you will be redirected to your
        company&apos;s SSO portal, if configured.
      </p>
      <Field label="Email Address" {...form.register("email")} type="email" />
    </Modal>
  );
}

// Skip the normal authentication flow
OAuthLookup.preAuth = true;
