import router from "next/router";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import LicenseSuccessModal from "./LicenseSuccessModal";

export default function VerifyingEmailModal() {
  const { apiCall } = useAuth();
  const { refreshOrganization, license } = useUser();

  const emailVerificationToken = String(
    router.query["email-verification-token"] || ""
  );

  const [verifyingEmail, setVerifyingEmail] = useState(
    !!emailVerificationToken
  );

  const [verifyEmailSuccess, setVerifyEmailSuccess] = useState(false);
  const [verifyEmailError, setVerifyEmailError] = useState("");
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

  return (
    <Modal
      open={true}
      cta="Invite Members"
      error={verifyEmailError}
      //close={() => close()}
      size="md"
      header={<h3>Verifying your account...</h3>}
    >
      <div>Please be patient while we verify your account.</div>
    </Modal>
  );
}
