import router from "next/router";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import LicenseSuccessModal from "./LicenseSuccessModal";
import UpgradeModal from ".";

export default function VerifyingEmailModal() {
  const { apiCall } = useAuth();
  const { refreshOrganization, license } = useUser();

  const emailVerificationToken = String(
    router.query["email-verification-token"] || "",
  );

  const [verifyingEmail, setVerifyingEmail] = useState(
    !!emailVerificationToken,
  );

  const [verifyEmailSuccess, setVerifyEmailSuccess] = useState(false);
  const [verifyEmailError, setVerifyEmailError] = useState("");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  useEffect(() => {
    if (!emailVerificationToken) return;
    setVerifyingEmail(true);

    apiCall(`/license/verify-email`, {
      method: "POST",
      body: JSON.stringify({
        emailVerificationToken,
      }),
    })
      .then(() => {
        setVerifyEmailSuccess(true);
        refreshOrganization();
        router.replace(router.pathname, router.pathname, { shallow: true });
      })
      .catch((e) => {
        setVerifyEmailError(e.message);
        console.error(e);
      });
  }, [apiCall, emailVerificationToken, refreshOrganization]);

  if (!verifyingEmail) return null;

  if (verifyEmailSuccess) {
    return (
      <LicenseSuccessModal
        plan={license?.plan === "enterprise" ? "Enterprise" : "Pro"}
        close={() => setVerifyingEmail(false)}
        header={"Account Verified"}
        isTrial={license?.isTrial}
      />
    );
  }

  if (showUpgradeModal) {
    router.replace(router.pathname, router.pathname, { shallow: true });
    return (
      <UpgradeModal
        close={() => setShowUpgradeModal(false)}
        source="verify email"
        commercialFeature={null}
      />
    );
  }

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      cta="Invite Members"
      error={verifyEmailError}
      //close={() => close()}
      size="md"
      header={<h3>Verifying your account...</h3>}
    >
      {verifyEmailError ? (
        <div>
          <span>
            There was an error trying to verify your email. Please{" "}
            <a
              href="#"
              onClick={() => {
                setShowUpgradeModal(true);
              }}
            >
              try again.
            </a>
          </span>
          <div className="alert alert-danger">{verifyEmailError}</div>
        </div>
      ) : (
        <div>Please be patient while we verify your account.</div>
      )}
    </Modal>
  );
}
