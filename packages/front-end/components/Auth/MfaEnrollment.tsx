import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import RecoveryCodes from "./RecoveryCodes";

// Enable/disable swap the session cookies, so a reload picks up the new token
export default function MfaEnrollment() {
  const { apiCall } = useAuth();
  const [setup, setSetup] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [code, setCode] = useState("");
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
          const res = await apiCall<{ recoveryCodes: string[] }>(
            "/user/mfa/enable",
            {
              method: "POST",
              body: JSON.stringify({ mfaCode: code }),
            },
          );
          setRecoveryCodes(res.recoveryCodes);
        });
      }}
    >
      <Flex direction="column" gap="3">
        <Text>
          Add GrowthBook to your authenticator app with this setup key, or{" "}
          <a href={setup.otpauthUrl}>open it in your authenticator app</a>:
        </Text>
        <code style={{ fontSize: "1.1em", wordBreak: "break-all" }}>
          {setup.secret.match(/.{1,4}/g)?.join(" ")}
        </code>
        <Field
          label="Authentication code"
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <Callout status="error">{error}</Callout>}
        <Button type="submit" loading={loading}>
          Turn on MFA
        </Button>
      </Flex>
    </form>
  );
}
