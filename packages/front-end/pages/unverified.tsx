import Link from "next/link";
import router from "next/router";
import React, { useContext } from "react";
import { useEffect, useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import Modal from "../components/Modal";
import { UserContext } from "../components/ProtectedPage";
import { useAuth } from "../services/auth";
import { getApiHost, isCloud } from "../services/env";

const UnverifiedPage = (): React.ReactElement => {
  const { apiCall } = useAuth();
  const { email, isVerified } = useContext(UserContext);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let key = null;
    const m =
      window.location.search.match(/(^|&|\?)verify=([a-zA-Z0-9]+)/) ?? null;
    if (m) {
      key = m[2];
    }

    setHasKey(!!key);
    if (!key) {
      return;
    }
    if (!hasKey) {
      setLoading(true);
    }

    if (!isVerified) {
      apiCall<{ status: number; orgId?: string; message?: string }>(
        `/auth/verify`,
        {
          method: "POST",
          body: JSON.stringify({
            key,
          }),
        }
      )
        .then((res) => {
          setLoading(false);
          if (res.orgId) {
            window.location.href = `/?org=${res.orgId}`;
          } else {
            setError(
              res.message ||
                "The verification token is invalid or has expired. Please request a new verification email."
            );
          }
        })
        .catch((e) => {
          setLoading(false);
          setError(e.message);
        });
    }
  }, []);

  if (isCloud()) {
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
      open={true}
      cta="Send a new verification email"
      autoCloseOnSubmit={false}
      submit={
        success || error || loading
          ? undefined
          : async () => {
              const res = await fetch(getApiHost() + "/auth/resetverify", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  email,
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
          <h3 className="mb-3">Verify Email</h3>
          <div className="alert alert-success">
            Sent a new verification email to <strong>{email}</strong>
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
          <p className="text">
            In order to use Growthbook you must first verify your email address.
          </p>
          <p className="text-muted">
            Please check your inbox at <strong>{email}</strong> for a
            verification email.
          </p>
          <input type="hidden" name="email" value={email} readOnly />
        </div>
      )}
    </Modal>
  );
};

export default UnverifiedPage;
