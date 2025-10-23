import Link from "next/link";
import { useRouter } from "next/router";
import { ReactElement, useEffect, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/components/Modal";
import { getApiHost, usingSSO } from "@/services/env";
import { trackPageView } from "@/services/track";

export default function ResetPasswordPage(): ReactElement {
  const router = useRouter();
  const token = router.query.token;
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    if (!token) {
      setError("Missing reset token");
      setLoading(false);
      return;
    }

    // Check if token is valid
    fetch(getApiHost() + "/auth/reset/" + token, { credentials: "include" })
      .then((res) => res.json())
      .then((json: { status: number; message?: string; email?: string }) => {
        if (json.status > 200) {
          setError(json.message || "Invalid reset token");
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
        <div className="alert alert-danger">
          Invalid URL. <Link href="/">Go Back</Link>
        </div>
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
                throw new Error(json.message || "An error occurred");
              }

              setSuccess(true);
            }
      }
    >
      {loading && <LoadingOverlay />}
      {error ? (
        <div className="alert alert-danger">{error}</div>
      ) : success ? (
        <div>
          <h3 className="mb-3">Reset Password</h3>
          <div className="alert alert-success">
            Successfully reset password for <strong>{email}</strong>
          </div>
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              setLoading(true);
              router.push("/");
            }}
          >
            Log In Now
          </button>
        </div>
      ) : (
        <div>
          <p className="text-muted">
            Reset password for <strong>{email}</strong>.
          </p>
          <input type="hidden" name="email" value={email} readOnly />
          <div className="form-group">
            New Password
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
