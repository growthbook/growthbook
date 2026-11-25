import { useRouter } from "next/router";
import { ReactElement, useEffect, useState } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import Link from "@/ui/Link";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/components/Modal";
import { getApiHost, usingSSO } from "@/services/env";
import { trackPageView } from "@/services/track";
import Callout from "@/ui/Callout";

export default function ResetPasswordPage(): ReactElement {
  const { t, i18n } = useLingui();
  const router = useRouter();
  const token = router.query.token;
  // A descriptor for our own messages, so the effect doesn't depend on the language
  const [error, setError] = useState<string | MessageDescriptor>("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    if (!token) {
      setError(msg`Missing reset token`);
      setLoading(false);
      return;
    }

    // Check if token is valid
    fetch(getApiHost() + "/auth/reset/" + token, { credentials: "include" })
      .then((res) => res.json())
      .then((json: { status: number; message?: string; email?: string }) => {
        if (json.status > 200) {
          setError(json.message || msg`Invalid reset token`);
          setLoading(false);
          return;
        }

        setEmail(json.email || "");
        setLoading(false);
      });
  }, [token, router.isReady]);

  // This page is before the user is part of an org, so need to manually fire a page load event
  useEffect(() => {
    trackPageView("/reset-password");
  }, []);

  if (usingSSO()) {
    return (
      <div className="container">
        <Callout status="error">
          <Trans>
            Invalid URL. <Link href="/">Go Back</Link>
          </Trans>
        </Callout>
      </div>
    );
  }

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      autoCloseOnSubmit={false}
      submit={
        success || error || loading
          ? undefined
          : async () => {
              const res = await fetch(getApiHost() + "/auth/reset/" + token, {
                credentials: "include",
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  token,
                  password,
                }),
              });
              const json: {
                status: number;
                message?: string;
              } = await res.json();
              if (json.status > 200) {
                throw new Error(json.message || t`An error occurred`);
              }

              setSuccess(true);
            }
      }
    >
      {loading && <LoadingOverlay />}
      {error ? (
        <Callout status="error">
          {typeof error === "string" ? error : i18n._(error)}
        </Callout>
      ) : success ? (
        <div>
          <h3 className="mb-3">
            <Trans>Reset Password</Trans>
          </h3>
          <Callout mb="3" status="success">
            <Trans>
              Successfully reset password for <strong>{email}</strong>
            </Trans>
          </Callout>
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              setLoading(true);
              router.push("/");
            }}
          >
            <Trans>Log In Now</Trans>
          </button>
        </div>
      ) : (
        <div>
          <p className="text-muted">
            <Trans>
              Reset password for <strong>{email}</strong>.
            </Trans>
          </p>
          <input type="hidden" name="email" value={email} readOnly />
          <div className="form-group">
            <Trans>New Password</Trans>
            <input
              type="password"
              className="form-control"
              autoFocus={true}
              minLength={8}
              required
              value={password}
              name="password"
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
ResetPasswordPage.preAuth = true;
