import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/services/auth";
import TextField from "@/ui/TextField";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import CopyableCode from "@/components/Settings/CopyableCode";
import RecoveryCodes from "./RecoveryCodes";

// Enable/disable swap the session cookies, so a reload picks up the new token
// onEnabled lets a host show the recovery codes itself and own the exit
export default function MfaEnrollment({
  onEnabled,
}: {
  onEnabled?: (recoveryCodes: string[]) => void;
}) {
  const { apiCall, setToken } = useAuth();
  const [setup, setSetup] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  if (recoveryCodes) {
    return (
      <Flex direction="column" gap="3">
        <RecoveryCodes codes={recoveryCodes} />
        <Button onClick={() => window.location.reload()}>Done</Button>
      </Flex>
    );
  }

  if (!setup) {
    return (
      <Flex direction="column" gap="3">
        <Text>
          Use an authenticator app such as 1Password, Authy, or Google
          Authenticator to generate a code each time you log in.
        </Text>
        {error && <Callout status="error">{error}</Callout>}
        <Button
          loading={loading}
          onClick={() =>
            run(async () => {
              setSetup(
                await apiCall<{ secret: string; otpauthUrl: string }>(
                  "/user/mfa/setup",
                  { method: "POST" },
                ),
              );
            })
          }
        >
          Set up MFA
        </Button>
      </Flex>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await apiCall<{ recoveryCodes: string[]; token: string }>(
            "/user/mfa/enable",
            {
              method: "POST",
              body: JSON.stringify({ mfaCode: code, currentPassword }),
            },
          );
          // The old token was revoked; keep this tab working while it shows the codes
          setToken?.(res.token);
          if (onEnabled) onEnabled(res.recoveryCodes);
          else setRecoveryCodes(res.recoveryCodes);
        });
      }}
    >
      <Flex direction="column" gap="3">
        <Text>Scan this QR code with your authenticator app:</Text>
        <Flex justify="center">
          <QRCodeSVG
            value={setup.otpauthUrl}
            size={176}
            marginSize={2}
            title="MFA setup QR code"
            style={{ background: "white" }}
          />
        </Flex>
        <Text>
          Can&apos;t scan it? Enter this setup key instead, or{" "}
          <Link href={setup.otpauthUrl}>open it in your authenticator app</Link>
          :
        </Text>
        <CopyableCode value={setup.secret} framed />
        <TextField
          label="Authentication code"
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{3} ?[0-9]{3}"
          title="The 6-digit code from your authenticator app"
          helpText="Enter the 6-digit code from your authenticator app."
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <TextField
          label="Current password"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        {error && <Callout status="error">{error}</Callout>}
        <Button type="submit" loading={loading}>
          Turn on MFA
        </Button>
      </Flex>
    </form>
  );
}
