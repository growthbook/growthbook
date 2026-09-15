import clsx from "clsx";
import { useEffect, useState } from "react";
import { FaCheckCircle } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import styles from "./index.module.scss";

interface Props {
  close: () => void;
  plan: "Pro" | "Enterprise";
  isTrial: boolean;
  reenterEmail: () => void;
  error?: string;
}

export default function PleaseVerifyEmailModal({
  plan,
  close,
  isTrial,
  reenterEmail,
  error: externalError,
}: Props) {
  const { license } = useUser();
  const { apiCall } = useAuth();

  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);

  useEffect(() => {
    track("View Verify Email Modal", { plan: plan });
  }, [plan]);

  useEffect(() => {
    setError(externalError || "");
  }, [externalError]);

  const resendVerificationEmail = async () => {
    if (loading) return;
    setError("");
    setLoading(true);
    setSuccess(false);
    try {
      await apiCall<{
        status: number;
        message?: string;
      }>(`/license/resend-verification-email`, {
        method: "POST",
      });

      setSuccess(true);
      setLoading(false);
    } catch (e) {
      setLoading(false);
      setError("Failed to send verification email: " + e.message);
    }
  };

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      cta="Close"
      includeCloseCta={false}
      close={close}
      size="md"
      header={<h3 className="mb-0">Verify your email address</h3>}
      submit={close}
      error={error}
      fullWidthSubmit={true}
      tertiaryCTA={
        <div className="text-center w-100 my-3">
          Don&apos;t see an email in the inbox of {license?.email}? Check your
          spam folder, {loading && <LoadingSpinner />}{" "}
          {success && <FaCheckCircle size={18} className="text-success" />}{" "}
          {(loading && (
            <a
              onClick={resendVerificationEmail}
              className={clsx(styles.unclickable)}
            >
              sending
            </a>
          )) || (
            <a onClick={resendVerificationEmail} className={""}>
              resend
            </a>
          )}{" "}
          email,{" "}
          <a onClick={reenterEmail} className={""}>
            re-enter
          </a>{" "}
          your email address, or{" "}
          <a
            href="mailto: support@growthbook.io"
            target="_blank"
            rel="noreferrer"
          >
            contact&nbsp;support
          </a>
          .
        </div>
      }
    >
      <div className="my-2">
        <b>Thanks for signing up!</b>
      </div>
      <div>
        Check your email for a verification link. Clicking the link will
        activate your{" "}
        {isTrial ? `free 14-day ${plan} plan trial` : `${plan} subscription`}.
      </div>
    </Modal>
  );
}
