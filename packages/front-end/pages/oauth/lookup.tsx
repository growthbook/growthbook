import { useState } from "react";
import { useForm } from "react-hook-form";
import { lookupByEmail } from "../../authSources/oidcAuthSource";
import Field from "../../components/Forms/Field";
import LoadingOverlay from "../../components/LoadingOverlay";
import Modal from "../../components/Modal";
import { setLastSSOConnectionId } from "../../services/auth";

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
        window.location.href = window.location.origin;
        // Wait for 5 seconds for the page to redirect
        await new Promise((resolve) => setTimeout(resolve, 5000));
      })}
      close={() => {
        setLastSSOConnectionId("");
        window.location.href = window.location.origin;
        setOpen(false);
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
