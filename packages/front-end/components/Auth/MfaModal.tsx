import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import TextField from "@/ui/TextField";
import Modal from "@/ui/Modal";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import MfaEnrollment from "./MfaEnrollment";
import RecoveryCodes from "./RecoveryCodes";

export default function MfaModal({ close }: { close: () => void }) {
  const { mfaEnabled, mfaRecoveryCodesRemaining = 0, updateUser } = useUser();
  const { apiCall } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"codes" | "disable" | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  // Turning MFA on swaps the session cookies, so leaving must reload
  const [enabledHere, setEnabledHere] = useState(false);
  const finish = () => (enabledHere ? window.location.reload() : close());

  const run = async (action: "codes" | "disable", fn: () => Promise<void>) => {
    setError("");
    setPending(action);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
    setPending(null);
  };

  return (
    <Modal.Root
      open={true}
      onOpenChange={(open) => {
        if (!open) finish();
      }}
      trackingEventModalType="mfa-settings"
    >
      <Modal.Header>
        <Modal.Title>Multi-Factor Authentication</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {newCodes ? (
          <RecoveryCodes codes={newCodes} />
        ) : !mfaEnabled ? (
          <MfaEnrollment
            onEnabled={(codes) => {
              setEnabledHere(true);
              setNewCodes(codes);
            }}
          />
        ) : (
          <Flex direction="column" gap="3">
            <Text as="p">
              MFA is on for your account. You have{" "}
              <Text weight="semibold">{mfaRecoveryCodesRemaining}</Text> unused
              recovery {mfaRecoveryCodesRemaining === 1 ? "code" : "codes"}.
            </Text>
            {mfaRecoveryCodesRemaining < 3 && (
              <Callout status="warning">
                You&apos;re running low on recovery codes. Get new ones so you
                can still log in if you lose your authenticator app.
              </Callout>
            )}
            <TextField
              label="Authentication code"
              helpText="Enter a code from your authenticator app, or a recovery code, to make changes."
              autoFocus
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && <Callout status="error">{error}</Callout>}
          </Flex>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close>
          <Button variant={newCodes ? "solid" : "ghost"} onClick={finish}>
            {newCodes ? "Done" : "Cancel"}
          </Button>
        </Modal.Close>
        {mfaEnabled && !newCodes && (
          <>
            <Button
              variant="outline"
              loading={pending === "codes"}
              disabled={!code.trim() || pending === "disable"}
              onClick={() =>
                run("codes", async () => {
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
              loading={pending === "disable"}
              disabled={!code.trim() || pending === "codes"}
              onClick={() =>
                run("disable", async () => {
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
