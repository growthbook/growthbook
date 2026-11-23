import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";
import { getApiHost } from "@/services/env";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

// Sign-in runs before there's a session, so this can't use apiCall
async function postToAuth<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(getApiHost() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json: T & { message?: string } = await res.json();
  if (!res.ok) {
    throw new Error(json.message || "An error occurred. Please try again.");
  }
  return json;
}

export default function PasskeySignInButton({
  onSuccess,
}: {
  onSuccess: (token: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!browserSupportsWebAuthn()) return null;

  const signIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const { options } = await postToAuth<{
        options: PublicKeyCredentialRequestOptionsJSON;
      }>("/auth/passkey/options", {});

      let response: AuthenticationResponseJSON;
      try {
        response = await startAuthentication({ optionsJSON: options });
      } catch {
        throw new Error(
          "Passkey sign-in was cancelled or didn't finish. Please try again.",
        );
      }

      const { token } = await postToAuth<{ token: string }>(
        "/auth/passkey/verify",
        { response },
      );
      onSuccess(token);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <Flex direction="column" gap="3" mb="4">
      <Button
        variant="outline"
        size="xl"
        loading={loading}
        style={{ width: "100%" }}
        onClick={signIn}
      >
        Sign in with a passkey
      </Button>
      {error && <Callout status="error">{error}</Callout>}
      <Text as="p" align="center" color="text-mid">
        or use your email
      </Text>
    </Flex>
  );
}
