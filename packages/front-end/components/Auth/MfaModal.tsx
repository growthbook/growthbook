import { useState } from "react";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import MfaEnrollment from "./MfaEnrollment";
import RecoveryCodes from "./RecoveryCodes";

export default function MfaModal({ close }: { close: () => void }) {
  const { mfaEnabled, mfaRecoveryCodesRemaining = 0, updateUser } = useUser();
  const { apiCall } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <Modal.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      trackingEventModalType="mfa-settings"
    >
      <Modal.Header>
        <Modal.Title>Multi-Factor Authentication</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!mfaEnabled ? (
          <MfaEnrollment />
        ) : newCodes ? (
          <RecoveryCodes codes={newCodes} />
        ) : (
          <>
            <p>
              MFA is on for your account. You have{" "}
              <strong>{mfaRecoveryCodesRemaining}</strong> unused recovery
              codes.
            </p>
            {mfaRecoveryCodesRemaining < 3 && (
              <Callout status="warning" mb="3">
                You&apos;re running low on recovery codes. Get new ones so you
                can still log in if you lose your authenticator app.
              </Callout>
            )}
            <Field
              label="Authentication code"
              helpText="Enter a code from your authenticator app, or a recovery code, to make changes."
              autoFocus
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && <Callout status="error">{error}</Callout>}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close>
          <Button variant="ghost" onClick={close}>
            {newCodes ? "Done" : "Cancel"}
          </Button>
        </Modal.Close>
        {mfaEnabled && !newCodes && (
          <>
            <Button
              variant="outline"
              loading={loading}
              onClick={() =>
                run(async () => {
                  const res = await apiCall<{ recoveryCodes: string[] }>(
                    "/user/mfa/recovery-codes",
                    { method: "POST", body: JSON.stringify({ mfaCode: code }) },
                  );
                  setNewCodes(res.recoveryCodes);
                  updateUser();
                })
              }
            >
              Get new recovery codes
            </Button>
            <Button
              color="red"
              loading={loading}
              onClick={() =>
                run(async () => {
                  await apiCall("/user/mfa/disable", {
                    method: "POST",
                    body: JSON.stringify({ mfaCode: code }),
                  });
                  window.location.reload();
                })
              }
            >
              Turn off MFA
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal.Root>
  );
}
