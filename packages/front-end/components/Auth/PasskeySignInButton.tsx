import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  WebAuthnAbortService,
  WebAuthnError,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
} from "@simplewebauthn/browser";
import { getApiHost } from "@/services/env";
import { describeWebAuthnError } from "@/services/passkeys";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

const DID_NOT_FINISH =
  "Passkey sign-in was cancelled or didn't finish. Please try again.";
// Sign-in challenges expire after 5 minutes, so autofill asks for a new one
// before then
const AUTOFILL_REFRESH_MS = 4 * 60 * 1000;

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

async function getSignInOptions() {
  const { options } = await postToAuth<{
    options: PublicKeyCredentialRequestOptionsJSON;
  }>("/auth/passkey/options", {});
  return options;
}

async function verifySignIn(response: AuthenticationResponseJSON) {
  const { token } = await postToAuth<{ token: string }>(
    "/auth/passkey/verify",
    { response },
  );
  return token;
}

// The browser runs one passkey request at a time, so starting another one
// cancels the last
function wasCancelled(e: unknown) {
  return e instanceof WebAuthnError && e.code === "ERROR_CEREMONY_ABORTED";
}

export default function PasskeySignInButton({
  onSuccess,
}: {
  onSuccess: (token: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [autofill, setAutofill] = useState(false);
  // Changing this starts the autofill request again with a new challenge
  const [autofillRound, setAutofillRound] = useState(0);
  // The button's request would cancel the autofill one, so autofill waits
  const [buttonBusy, setButtonBusy] = useState(false);

  useEffect(() => {
    browserSupportsWebAuthnAutofill().then(setAutofill);
  }, []);

  // Lists the user's passkeys in the email field's autofill, next to saved
  // emails, until they pick one or leave the login page
  useEffect(() => {
    if (!autofill || buttonBusy) return;
    let stopped = false;
    let waiting = false;
    const tryAgain = () => setAutofillRound((round) => round + 1);
    const refresh = setTimeout(tryAgain, AUTOFILL_REFRESH_MS);

    (async () => {
      let options: PublicKeyCredentialRequestOptionsJSON;
      try {
        options = await getSignInOptions();
      } catch {
        // Nobody asked for this, so fail quietly. The button still works.
        return;
      }
      if (stopped) return;

      let response: AuthenticationResponseJSON;
      waiting = true;
      try {
        response = await startAuthentication({
          optionsJSON: options,
          useBrowserAutofill: true,
        });
      } catch (e) {
        // Some of these fail straight away, like a wrong WEBAUTHN_RP_ID, so
        // leave the retry to the refresh instead of looping
        if (!stopped && !wasCancelled(e)) {
          setError(describeWebAuthnError(e) ?? DID_NOT_FINISH);
        }
        return;
      } finally {
        waiting = false;
      }

      // The challenge is used now, so a refresh can't help
      clearTimeout(refresh);
      try {
        onSuccess(await verifySignIn(response));
      } catch (e) {
        if (!stopped) {
          setError(e.message);
          tryAgain();
        }
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(refresh);
      if (waiting) WebAuthnAbortService.cancelCeremony();
    };
  }, [autofill, autofillRound, buttonBusy, onSuccess]);

  if (!browserSupportsWebAuthn()) return null;

  // Button shows the spinner and passes anything thrown here to setError
  const signIn = async () => {
    setButtonBusy(true);
    try {
      const options = await getSignInOptions();

      let response: AuthenticationResponseJSON;
      try {
        response = await startAuthentication({ optionsJSON: options });
      } catch (e) {
        throw new Error(describeWebAuthnError(e) ?? DID_NOT_FINISH);
      }

      onSuccess(await verifySignIn(response));
    } catch (e) {
      // Didn't sign in, so bring the autofill back
      setButtonBusy(false);
      throw e;
    }
  };

  return (
    <Flex direction="column" gap="3" mb="4">
      <Button
        variant="outline"
        size="xl"
        style={{ width: "100%" }}
        onClick={signIn}
        setError={setError}
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
